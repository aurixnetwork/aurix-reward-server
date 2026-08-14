import { id, Wallet } from "ethers";
import { describe, expect, it, vi } from "vitest";

import type { AuthorizationRepository } from "../src/authorization/authorization-repository.js";
import {
  createAndSignRewardAuthorization,
  planRewardAuthorization,
  verifyPersistedAuthorization,
} from "../src/authorization/authorization-service.js";
import type {
  AuthorizationJobRecord,
  CampaignAuthorizationReader,
  PlannedAuthorizationInput,
} from "../src/authorization/authorization-types.js";
import { TestRewardEligibilityService } from "../src/authorization/eligibility.js";
import {
  REWARD_AUTHORIZATION_TYPE_STRING,
} from "../src/config/constants.js";
import type { RewardCampaign, RewardClaimantState } from "../src/contracts/reward-contract-client.js";
import type { PublicWalletRecord } from "../src/wallets/wallet-types.js";

const approverPrivateKey = `0x${"66".repeat(32)}`;
const approverAddress = new Wallet(approverPrivateKey).address;
const campaignId = `0x${"11".repeat(32)}`;
const rewardId = `0x${"22".repeat(32)}`;
const nowSeconds = 1_800_000_000;
const wallet: PublicWalletRecord = {
  createdAt: new Date("2026-08-15T00:00:00.000Z"),
  id: "1",
  status: "ACTIVE",
  walletAddress: "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A",
};

const activeCampaign: RewardCampaign = {
  active: true,
  budget: 1_000n,
  claimInterval: 3_600n,
  distributed: 100n,
  endTime: BigInt(nowSeconds + 10_000),
  exists: true,
  maxRewardAmount: 100n,
  startTime: BigInt(nowSeconds - 100),
};

const claimantState: RewardClaimantState = {
  claimIntervalElapsed: true,
  lastClaimAt: 0n,
  nextClaimAt: 0n,
  rewardNonce: 7n,
};

function reader(options: {
  readonly campaign?: RewardCampaign;
  readonly claimant?: RewardClaimantState;
  readonly paused?: boolean;
  readonly role?: boolean;
} = {}) {
  const getRewardNonceSpy = vi.fn().mockResolvedValue(options.claimant?.rewardNonce ?? 7n);
  const getClaimantStateSpy = vi.fn().mockResolvedValue(options.claimant ?? claimantState);
  const hasApproverRoleSpy = vi.fn().mockResolvedValue(options.role ?? true);
  return {
    getAuthorizationTypeHash: vi.fn().mockResolvedValue(id(REWARD_AUTHORIZATION_TYPE_STRING)),
    getCampaign: vi.fn().mockResolvedValue(options.campaign ?? activeCampaign),
    getClaimantState: getClaimantStateSpy,
    getClaimantStateSpy,
    getRewardNonce: getRewardNonceSpy,
    getRewardNonceSpy,
    hasApproverRole: hasApproverRoleSpy,
    hasApproverRoleSpy,
    isPaused: vi.fn().mockResolvedValue(options.paused ?? false),
    isRewardIdUsed: vi.fn().mockResolvedValue(false),
  } as unknown as CampaignAuthorizationReader & {
    readonly getRewardNonceSpy: ReturnType<typeof vi.fn>;
    readonly getClaimantStateSpy: ReturnType<typeof vi.fn>;
    readonly hasApproverRoleSpy: ReturnType<typeof vi.fn>;
  };
}

class FakeAuthorizationRepository implements AuthorizationRepository {
  public readonly events: string[] = [];
  public planned?: PlannedAuthorizationInput;
  public hash?: string;
  public signature?: string;

  public findByJobId(): Promise<AuthorizationJobRecord | undefined> {
    return Promise.resolve(undefined);
  }
  public insertPlanned(input: PlannedAuthorizationInput): Promise<void> {
    this.events.push("PLANNED");
    this.planned = input;
    return Promise.resolve();
  }
  public markFailed(): Promise<void> {
    this.events.push("FAILED");
    return Promise.resolve();
  }
  public markReady(_jobId: string, hash: string, signature: string): Promise<void> {
    this.events.push("READY");
    this.hash = hash;
    this.signature = signature;
    return Promise.resolve();
  }
}

function plan(overrides: Partial<Parameters<typeof planRewardAuthorization>[0]> = {}) {
  return planRewardAuthorization({
    amount: 50n,
    campaignId,
    eligibility: new TestRewardEligibilityService(),
    nowSeconds,
    reader: reader(),
    rewardId,
    validitySeconds: 300,
    wallet,
    ...overrides,
  });
}

describe("reward authorization preparation", () => {
  it("reads rewardNonce from the contract abstraction and prepares a valid plan", async () => {
    const contract = reader();
    const result = await plan({ reader: contract });
    expect(result.status).toBe("READY_TO_AUTHORIZE");
    if (result.status !== "READY_TO_AUTHORIZE") throw new Error("unexpected block");
    expect(result.authorization.rewardNonce).toBe(7n);
    expect(result.transactionsSent).toBe(0);
    expect(contract.getClaimantStateSpy).toHaveBeenCalledWith(campaignId, wallet.walletAddress);
    expect("broadcastTransaction" in contract).toBe(false);
  });

  it("blocks a missing campaign without inventing one", async () => {
    const result = await plan({ reader: reader({ campaign: { ...activeCampaign, exists: false } }) });
    expect(result).toMatchObject({ code: "BLOCKED_CAMPAIGN_NOT_FOUND", status: "BLOCKED" });
  });

  it("blocks an inactive campaign", async () => {
    const result = await plan({ reader: reader({ campaign: { ...activeCampaign, active: false } }) });
    expect(result).toMatchObject({ code: "BLOCKED_CAMPAIGN_INACTIVE", status: "BLOCKED" });
  });

  it("enforces campaign maxRewardAmount", async () => {
    const result = await plan({ amount: 101n });
    expect(result).toMatchObject({ code: "BLOCKED_AMOUNT_EXCEEDS_MAX", status: "BLOCKED" });
  });

  it("enforces campaign remaining budget", async () => {
    const result = await plan({
      amount: 50n,
      reader: reader({ campaign: { ...activeCampaign, budget: 120n } }),
    });
    expect(result).toMatchObject({ code: "BLOCKED_CAMPAIGN_BUDGET", status: "BLOCKED" });
  });

  it("enforces the claimant claim interval", async () => {
    const result = await plan({
      reader: reader({
        claimant: { ...claimantState, claimIntervalElapsed: false, nextClaimAt: BigInt(nowSeconds + 1) },
      }),
    });
    expect(result).toMatchObject({ code: "BLOCKED_CLAIM_INTERVAL", status: "BLOCKED" });
  });

  it("blocks denied TEST ELIGIBILITY", async () => {
    const result = await plan({ eligibility: new TestRewardEligibilityService(false, "TEST_DENIED") });
    expect(result).toMatchObject({ code: "BLOCKED_TEST_ELIGIBILITY_DENIED", status: "BLOCKED" });
  });

  it("blocks an inactive User Wallet", async () => {
    const result = await plan({ wallet: { ...wallet, status: "DISABLED" } });
    expect(result).toMatchObject({ code: "BLOCKED_USER_WALLET_INACTIVE", status: "BLOCKED" });
  });

  it("rejects a zero amount", async () => {
    await expect(plan({ amount: 0n })).rejects.toThrow("greater than zero");
  });
});

describe("reward authorization signing and verification", () => {
  it("persists PLANNED before signing and produces a READY authorization", async () => {
    const repository = new FakeAuthorizationRepository();
    const contract = reader();
    const job = await createAndSignRewardAuthorization({
      amount: 50n,
      approverAddress,
      approverPrivateKey,
      campaignId,
      eligibility: new TestRewardEligibilityService(),
      entropy: `0x${"77".repeat(32)}`,
      jobId: "00000000-0000-4000-8000-000000000001",
      nowSeconds,
      reader: contract,
      repository,
      validitySeconds: 300,
      wallet,
    });
    expect(repository.events).toEqual(["PLANNED", "READY"]);
    expect(repository.planned?.rewardId).toBe(job.rewardId);
    expect(repository.planned?.rewardId).not.toBe(`0x${"00".repeat(32)}`);
    expect(job.status).toBe("READY");
    expect(job.approverAddress).toBe(approverAddress);
    expect(repository.hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(repository.signature).toMatch(/^0x[0-9a-f]{130}$/);
    expect(contract.getRewardNonceSpy).toHaveBeenCalledWith(campaignId, wallet.walletAddress);
    expect(contract.hasApproverRoleSpy).toHaveBeenCalledWith(approverAddress);
  });

  it("rejects a wrong Approver after signature recovery", async () => {
    const repository = new FakeAuthorizationRepository();
    await expect(createAndSignRewardAuthorization({
      amount: 50n,
      approverAddress: new Wallet(`0x${"67".repeat(32)}`).address,
      approverPrivateKey,
      campaignId,
      eligibility: new TestRewardEligibilityService(),
      entropy: `0x${"77".repeat(32)}`,
      jobId: "00000000-0000-4000-8000-000000000002",
      nowSeconds,
      reader: reader(),
      repository,
      validitySeconds: 300,
      wallet,
    })).rejects.toThrow("Recovered authorization signer");
    expect(repository.events).toEqual(["PLANNED", "FAILED"]);
  });

  it("rejects an Approver without the on-chain role", async () => {
    await expect(createAndSignRewardAuthorization({
      amount: 50n,
      approverAddress,
      approverPrivateKey,
      campaignId,
      eligibility: new TestRewardEligibilityService(),
      entropy: `0x${"77".repeat(32)}`,
      jobId: "00000000-0000-4000-8000-000000000003",
      nowSeconds,
      reader: reader({ role: false }),
      repository: new FakeAuthorizationRepository(),
      validitySeconds: 300,
      wallet,
    })).rejects.toThrow("APPROVER_ROLE");
  });

  it("rejects an authorization that expires before signing", async () => {
    const repository = new FakeAuthorizationRepository();
    await expect(createAndSignRewardAuthorization({
      amount: 50n,
      approverAddress,
      approverPrivateKey,
      campaignId,
      clock: () => nowSeconds + 300,
      eligibility: new TestRewardEligibilityService(),
      entropy: `0x${"77".repeat(32)}`,
      jobId: "00000000-0000-4000-8000-000000000006",
      nowSeconds,
      reader: reader(),
      repository,
      validitySeconds: 300,
      wallet,
    })).rejects.toThrow("expired");
    expect(repository.events).toEqual(["PLANNED", "FAILED"]);
    expect(repository.signature).toBeUndefined();
  });

  it("identifies a stale contract rewardNonce without sending a transaction", async () => {
    const repository = new FakeAuthorizationRepository();
    const job = await createAndSignRewardAuthorization({
      amount: 50n, approverAddress, approverPrivateKey, campaignId,
      eligibility: new TestRewardEligibilityService(), entropy: `0x${"77".repeat(32)}`,
      jobId: "00000000-0000-4000-8000-000000000004", nowSeconds,
      reader: reader(), repository, validitySeconds: 300, wallet,
    });
    const staleReader = reader({ claimant: { ...claimantState, rewardNonce: 8n } });
    const result = await verifyPersistedAuthorization(
      job, staleReader, approverAddress, nowSeconds,
    );
    expect(result.status).toBe("STALE_NONCE");
    expect(result.transactionsSent).toBe(0);
    expect("broadcastTransaction" in staleReader).toBe(false);
  });

  it("identifies expired and malformed persisted signatures", async () => {
    const repository = new FakeAuthorizationRepository();
    const job = await createAndSignRewardAuthorization({
      amount: 50n, approverAddress, approverPrivateKey, campaignId,
      eligibility: new TestRewardEligibilityService(), entropy: `0x${"77".repeat(32)}`,
      jobId: "00000000-0000-4000-8000-000000000005", nowSeconds,
      reader: reader(), repository, validitySeconds: 300, wallet,
    });
    await expect(verifyPersistedAuthorization(
      job, reader(), approverAddress, nowSeconds + 300,
    )).resolves.toMatchObject({ status: "EXPIRED" });
    await expect(verifyPersistedAuthorization(
      { ...job, approverSignature: "0x1234" }, reader(), approverAddress, nowSeconds,
    )).resolves.toMatchObject({ status: "INVALID_SIGNATURE" });
  });
});
