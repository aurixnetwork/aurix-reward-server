import { parseEther, Wallet } from "ethers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  hashRewardAuthorization,
  signRewardAuthorization,
} from "../src/authorization/eip712.js";
import type { AuthorizationJobRecord } from "../src/authorization/authorization-types.js";
import { buildClaimPlan } from "../src/claim/claim-plan.js";
import type {
  ClaimChainReader,
  ClaimJobRecord,
  ClaimProvider,
  ClaimTokenReader,
} from "../src/claim/claim-types.js";
import {
  AURIX_REWARD_CONTRACT_ADDRESS,
  IRB_TEST_TOKEN_ADDRESS,
} from "../src/config/constants.js";
import type { RewardCampaign, RewardClaimantState } from "../src/contracts/reward-contract-client.js";
import type { PublicWalletRecord } from "../src/wallets/wallet-types.js";

const claimantWallet = new Wallet(`0x${"44".repeat(32)}`);
const approverWallet = new Wallet(`0x${"55".repeat(32)}`);
const campaignId = `0x${"11".repeat(32)}`;
const rewardId = `0x${"22".repeat(32)}`;

let campaign: RewardCampaign;
let claimantState: RewardClaimantState;
let paused: boolean;
let used: boolean;
let approverRole: boolean;
let contractBalance: bigint;
let userGasBalance: bigint;
let latestTimestamp: number;
let chainId: bigint;
let job: AuthorizationJobRecord;
let wallet: PublicWalletRecord;
let reader: ClaimChainReader;
let token: ClaimTokenReader;
let provider: ClaimProvider & {
  readonly broadcastSpy: ReturnType<typeof vi.fn>;
  readonly estimateGasSpy: ReturnType<typeof vi.fn>;
};

beforeEach(async () => {
  campaign = {
    active: true,
    budget: parseEther("3"),
    claimInterval: 3_600n,
    distributed: 0n,
    endTime: 4_000n,
    exists: true,
    maxRewardAmount: parseEther("0.1"),
    startTime: 100n,
  };
  claimantState = {
    claimIntervalElapsed: true,
    lastClaimAt: 0n,
    nextClaimAt: 0n,
    rewardNonce: 7n,
  };
  paused = false;
  used = false;
  approverRole = true;
  contractBalance = parseEther("3.3");
  userGasBalance = parseEther("0.01");
  latestTimestamp = 2_000;
  chainId = 97n;
  const authorization = {
    amount: parseEther("0.1"),
    campaignId,
    claimant: claimantWallet.address,
    deadline: 3_000n,
    rewardId,
    rewardNonce: 7n,
    validAfter: 1_000n,
  };
  const signature = await signRewardAuthorization(authorization, approverWallet.privateKey);
  job = {
    ...authorization,
    approverAddress: approverWallet.address,
    approverSignature: signature,
    jobId: "0d4ebebf-82f2-4d1a-a7df-c09a4db256ae",
    status: "READY",
    typedDataHash: hashRewardAuthorization(authorization),
    walletId: "1",
  };
  wallet = {
    createdAt: new Date(0),
    id: "1",
    status: "ACTIVE",
    walletAddress: claimantWallet.address,
  };
  reader = {
    getCampaign: vi.fn(() => Promise.resolve(campaign)),
    getClaimantState: vi.fn(() => Promise.resolve(claimantState)),
    getRewardToken: vi.fn(() => Promise.resolve(IRB_TEST_TOKEN_ADDRESS)),
    hasApproverRole: vi.fn(() => Promise.resolve(approverRole)),
    isPaused: vi.fn(() => Promise.resolve(paused)),
    isRewardIdUsed: vi.fn(() => Promise.resolve(used)),
  };
  token = {
    balanceOf: vi.fn((address: string) => Promise.resolve(
      address === AURIX_REWARD_CONTRACT_ADDRESS ? contractBalance : 0n)),
  };
  const broadcastSpy = vi.fn().mockRejectedValue(new Error("must not broadcast"));
  const estimateGasSpy = vi.fn().mockResolvedValue(100_000n);
  provider = {
    broadcastSpy,
    broadcastTransaction: broadcastSpy,
    estimateGas: estimateGasSpy,
    estimateGasSpy,
    getBalance: vi.fn(() => Promise.resolve(userGasBalance)),
    getBlock: vi.fn(() => Promise.resolve({ timestamp: latestTimestamp })),
    getCode: vi.fn().mockResolvedValue("0x6000"),
    getFeeData: vi.fn().mockResolvedValue({ gasPrice: 3_000_000_000n }),
    getNetwork: vi.fn(() => Promise.resolve({ chainId })),
    getTransaction: vi.fn().mockResolvedValue(null),
    getTransactionCount: vi.fn().mockResolvedValue(42),
    getTransactionReceipt: vi.fn().mockResolvedValue(null),
  };
});

async function plan(options: { readonly existingJob?: ClaimJobRecord } = {}) {
  return buildClaimPlan({
    authorization: job,
    ...(options.existingJob ? { existingJob: options.existingJob } : {}),
    expectedApprover: approverWallet.address,
    irbTokenAddress: IRB_TEST_TOKEN_ADDRESS,
    provider,
    reader,
    rewardContractAddress: AURIX_REWARD_CONTRACT_ADDRESS,
    token,
    wallet,
  });
}

function codes(result: Awaited<ReturnType<typeof plan>>): string[] {
  return result.blockers.map((blocker) => blocker.code);
}

describe("claim pre-broadcast plan", () => {
  it("plans a valid READY authorization without broadcasting or decrypting", async () => {
    const result = await plan();
    expect(result.expectedAction).toBe("SIGN_AND_BROADCAST");
    expect(result.blockers).toEqual([]);
    expect(result.estimatedGas).toBe(100_000n);
    expect(result.gasLimit).toBe(120_000n);
    expect(result.currentEthereumTxNonce).toBe(42);
    expect(result.transaction).toMatchObject({ from: claimantWallet.address, nonce: 42, to: AURIX_REWARD_CONTRACT_ADDRESS });
    expect(provider.broadcastSpy).not.toHaveBeenCalled();
    expect(result.transactionsSent).toBe(0);
  });

  it("blocks an expired authorization using the latest block timestamp", async () => {
    latestTimestamp = 3_001;
    expect(codes(await plan())).toContain("BLOCKED_AUTHORIZATION_EXPIRED");
  });

  it("blocks a not-yet-valid authorization", async () => {
    latestTimestamp = 999;
    expect(codes(await plan())).toContain("BLOCKED_AUTHORIZATION_NOT_YET_VALID");
  });

  it("blocks a stale rewardNonce independently of Ethereum tx nonce", async () => {
    claimantState = { ...claimantState, rewardNonce: 8n };
    const result = await plan();
    expect(codes(result)).toContain("BLOCKED_STALE_REWARD_NONCE");
    expect(result.authorization.rewardNonce).toBe(7n);
    expect(result.currentEthereumTxNonce).toBe(42);
  });

  it("routes an already-used rewardId to reconciliation", async () => {
    used = true;
    const result = await plan();
    expect(codes(result)).toContain("BLOCKED_REWARD_ID_USED");
    expect(result.expectedAction).toBe("RECONCILE_REWARD_ALREADY_USED");
  });

  it("blocks an invalid Approver signature", async () => {
    job = { ...job, approverSignature: "0x1234" };
    expect(codes(await plan())).toContain("BLOCKED_INVALID_APPROVER_SIGNATURE");
  });

  it("blocks a wrong Approver", async () => {
    const wrong = new Wallet(`0x${"66".repeat(32)}`);
    const authorization = {
      amount: job.amount, campaignId: job.campaignId, claimant: job.claimant,
      deadline: job.deadline, rewardId: job.rewardId, rewardNonce: job.rewardNonce,
      validAfter: job.validAfter,
    };
    job = {
      ...job,
      approverAddress: wrong.address,
      approverSignature: await signRewardAuthorization(authorization, wrong.privateKey),
    };
    expect(codes(await plan())).toContain("BLOCKED_WRONG_APPROVER");
  });

  it("blocks a signer whose APPROVER_ROLE was revoked", async () => {
    approverRole = false;
    expect(codes(await plan())).toContain("BLOCKED_APPROVER_ROLE_MISSING");
  });

  it("blocks an inactive campaign", async () => {
    campaign = { ...campaign, active: false };
    expect(codes(await plan())).toContain("BLOCKED_CAMPAIGN_INACTIVE");
  });

  it("blocks a paused contract", async () => {
    paused = true;
    expect(codes(await plan())).toContain("BLOCKED_CONTRACT_PAUSED");
  });

  it.each([
    [99, "BLOCKED_CAMPAIGN_NOT_STARTED"],
    [4_001, "BLOCKED_CAMPAIGN_ENDED"],
  ])("blocks campaign time outside its window at %i", async (timestamp, expected) => {
    latestTimestamp = timestamp;
    expect(codes(await plan())).toContain(expected);
  });

  it("blocks an amount over maxRewardAmount", async () => {
    campaign = { ...campaign, maxRewardAmount: job.amount - 1n };
    expect(codes(await plan())).toContain("BLOCKED_AMOUNT_EXCEEDS_MAX");
  });

  it("blocks insufficient campaign budget", async () => {
    campaign = { ...campaign, distributed: campaign.budget - job.amount + 1n };
    expect(codes(await plan())).toContain("BLOCKED_CAMPAIGN_BUDGET");
  });

  it("blocks insufficient Reward Contract IRB", async () => {
    contractBalance = job.amount - 1n;
    expect(codes(await plan())).toContain("BLOCKED_REWARD_CONTRACT_IRB");
  });

  it("blocks an inactive User Wallet", async () => {
    wallet = { ...wallet, status: "DISABLED" };
    expect(codes(await plan())).toContain("BLOCKED_USER_WALLET_INACTIVE");
  });

  it("blocks an unsatisfied claim interval", async () => {
    claimantState = { ...claimantState, claimIntervalElapsed: false, nextClaimAt: 2_100n };
    expect(codes(await plan())).toContain("BLOCKED_CLAIM_INTERVAL");
  });

  it("blocks insufficient claimant tBNB with the 20 percent gas margin", async () => {
    userGasBalance = 120_000n * 3_000_000_000n - 1n;
    expect(codes(await plan())).toContain("BLOCKED_INSUFFICIENT_USER_GAS");
  });

  it("reconciles an unresolved claim job instead of allocating a new nonce", async () => {
    const existing = existingClaim("BROADCAST");
    const result = await plan({ existingJob: existing });
    expect(result.expectedAction).toBe("RECONCILE_EXISTING");
    expect(provider.estimateGasSpy).not.toHaveBeenCalled();
  });

  it("skips a confirmed claim job", async () => {
    const result = await plan({ existingJob: existingClaim("CONFIRMED") });
    expect(result.expectedAction).toBe("SKIP_ALREADY_CONFIRMED");
  });

  it("fails closed on a wrong chain", async () => {
    chainId = 56n;
    expect(codes(await plan())).toContain("BLOCKED_WRONG_CHAIN");
  });
});

function existingClaim(status: ClaimJobRecord["status"]): ClaimJobRecord {
  return {
    amount: job.amount,
    authorizationJobId: job.jobId,
    campaignDistributedBefore: 0n,
    campaignId,
    claimant: claimantWallet.address,
    gasLimit: 120_000n,
    gasPriceWei: 3_000_000_000n,
    irbBalanceBefore: 0n,
    jobId: "a".repeat(64),
    rewardContractBalanceBefore: parseEther("3.3"),
    rewardId,
    rewardNonce: 7n,
    signedTxHash: `0x${"ab".repeat(32)}`,
    status,
    txNonce: 42,
    walletId: "1",
  };
}
