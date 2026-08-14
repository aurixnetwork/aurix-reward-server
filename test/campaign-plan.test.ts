import { parseEther, parseUnits, type TransactionRequest } from "ethers";
import { describe, expect, it, vi } from "vitest";

import {
  createTestCampaignCreationPlan,
  createTestCampaignProposal,
  deriveCampaignId,
  emptyCampaign,
  TEST_CAMPAIGN_LABEL,
  validateCampaignProposal,
  type CampaignPlanProvider,
  type TestCampaignProposal,
} from "../src/campaign/campaign-plan.js";
import { presentCampaignCreationPlan } from "../src/campaign/campaign-output.js";
import {
  AURIX_REWARD_CONTRACT_ADDRESS,
  BSC_TESTNET_CHAIN_ID,
  IRB_TEST_TOKEN_ADDRESS,
  TESTNET_ADMIN_ADDRESS,
  TESTNET_APPROVER_ADDRESS,
  TESTNET_OPERATIONS_ADDRESS,
} from "../src/config/constants.js";
import type { IrbTokenClient } from "../src/contracts/irb-token-client.js";
import type { RewardContractClient } from "../src/contracts/reward-contract-client.js";

const tokenOwner = "0xD0801a18cF74893B12849A6f2E7b4E469b5FFc89";
const roleIds = {
  APPROVER_ROLE: `0x${"11".repeat(32)}`,
  CAMPAIGN_MANAGER_ROLE: `0x${"22".repeat(32)}`,
  DEFAULT_ADMIN_ROLE: `0x${"00".repeat(32)}`,
  TREASURY_ROLE: `0x${"33".repeat(32)}`,
} as const;

function provider(): CampaignPlanProvider {
  return {
    estimateGas: vi.fn((transaction: TransactionRequest) => {
      if (transaction.value && BigInt(transaction.value.toString()) > 0n) {
        return Promise.resolve(21_000n);
      }
      if (transaction.to === AURIX_REWARD_CONTRACT_ADDRESS) return Promise.resolve(100_000n);
      if (transaction.to === IRB_TEST_TOKEN_ADDRESS) return Promise.resolve(55_000n);
      throw new Error("Unexpected transaction estimate");
    }),
    getBalance: vi.fn((address: string) => Promise.resolve(
      address === TESTNET_OPERATIONS_ADDRESS ? 0n : parseEther("1"),
    )),
    getBlock: vi.fn().mockResolvedValue({ number: 100, timestamp: 1_800_000_000 }),
    getFeeData: vi.fn().mockResolvedValue({ gasPrice: 100_000_000n }),
    getNetwork: vi.fn().mockResolvedValue({ chainId: BigInt(BSC_TESTNET_CHAIN_ID) }),
  };
}

function rewardClient(options: {
  readonly campaignExists?: boolean;
  readonly operationsHasRole?: boolean;
} = {}): Pick<
  RewardContractClient,
  "getCampaign" | "getClaimIntervalBounds" | "getRoleId" | "hasRole" | "isPaused"
> {
  return {
    getCampaign: vi.fn().mockResolvedValue({
      ...emptyCampaign(),
      exists: options.campaignExists ?? false,
    }),
    getClaimIntervalBounds: vi.fn().mockResolvedValue({ maximum: 604_800n, minimum: 3_600n }),
    getRoleId: vi.fn((role: keyof typeof roleIds) => Promise.resolve(roleIds[role])),
    hasRole: vi.fn((role: string, address: string) => Promise.resolve(
      (role === roleIds.DEFAULT_ADMIN_ROLE && address === TESTNET_ADMIN_ADDRESS) ||
      (role === roleIds.TREASURY_ROLE && address === TESTNET_ADMIN_ADDRESS) ||
      (role === roleIds.APPROVER_ROLE && address === TESTNET_APPROVER_ADDRESS) ||
      (role === roleIds.CAMPAIGN_MANAGER_ROLE &&
        address === TESTNET_OPERATIONS_ADDRESS &&
        (options.operationsHasRole ?? true)),
    )),
    isPaused: vi.fn().mockResolvedValue(false),
  };
}

function irbClient(ownerBalance = parseUnits("100", 18)): Pick<IrbTokenClient, "balanceOf" | "owner"> {
  return {
    balanceOf: vi.fn((address: string) => Promise.resolve(
      address === tokenOwner ? ownerBalance : 0n,
    )),
    owner: vi.fn().mockResolvedValue(tokenOwner),
  };
}

function plan(options: {
  readonly campaignExists?: boolean;
  readonly operationsHasRole?: boolean;
  readonly ownerBalance?: bigint;
  readonly walletCount?: number;
} = {}) {
  return createTestCampaignCreationPlan({
    activeWalletCount: options.walletCount ?? 10,
    irbClient: irbClient(options.ownerBalance),
    provider: provider(),
    rewardClient: rewardClient(options),
  });
}

describe("Test Campaign proposal policy", () => {
  it("derives the deterministic campaign ID from the exact UTF-8 label", () => {
    expect(deriveCampaignId(TEST_CAMPAIGN_LABEL)).toBe(
      "0x8509292576353d7b1173acb5a1a30074fecb8972df178c423389f95b3be2daac",
    );
  });

  it("rejects invalid deployed interval bounds", () => {
    const proposal = createTestCampaignProposal(1_800_000_000);
    expect(() => validateCampaignProposal(
      { ...proposal, claimInterval: 3_599n },
      { minimum: 3_600n, maximum: 604_800n },
    )).toThrow("interval");
    expect(() => validateCampaignProposal(
      { ...proposal, claimInterval: 604_801n },
      { minimum: 3_600n, maximum: 604_800n },
    )).toThrow("interval");
  });

  it("rejects invalid budget and maximum values", () => {
    const proposal = createTestCampaignProposal(1_800_000_000);
    expect(() => validateCampaignProposal(
      { ...proposal, budget: 0n },
      { minimum: 3_600n, maximum: 604_800n },
    )).toThrow("budget");
    expect(() => validateCampaignProposal(
      { ...proposal, maxRewardAmount: proposal.budget + 1n },
      { minimum: 3_600n, maximum: 604_800n },
    )).toThrow("maximum");
    expect(() => validateCampaignProposal(
      { ...proposal, maxRewardAmount: 0n },
      { minimum: 3_600n, maximum: 604_800n },
    )).toThrow("maximum");
  });

  it("rejects an invalid start/end range", () => {
    const proposal = createTestCampaignProposal(1_800_000_000);
    const invalid = { ...proposal, endTime: proposal.startTime } satisfies TestCampaignProposal;
    expect(() => validateCampaignProposal(
      invalid,
      { minimum: 3_600n, maximum: 604_800n },
    )).toThrow("start/end");
  });
});

describe("read-only Test Campaign creation plan", () => {
  it("detects a duplicate campaign without estimating creation", async () => {
    const result = await plan({ campaignExists: true });
    expect(result.status).toBe("BLOCKED");
    expect(result.blockers).toContain("CAMPAIGN_ALREADY_EXISTS");
    expect(result.transactions.some((transaction) => transaction.kind === "CAMPAIGN_CREATE"))
      .toBe(false);
  });

  it("detects the wrong campaign manager role", async () => {
    const result = await plan({ operationsHasRole: false });
    expect(result.status).toBe("BLOCKED");
    expect(result.blockers).toContain("OPERATIONS_MISSING_CAMPAIGN_MANAGER_ROLE");
  });

  it("detects insufficient IRB without planning an invalid transfer", async () => {
    const result = await plan({ ownerBalance: 0n });
    expect(result.blockers).toContain("IRB_SOURCE_INSUFFICIENT");
    expect(result.transactions.some((transaction) => transaction.kind === "IRB_TRANSFER"))
      .toBe(false);
  });

  it("plans gas top-up, campaign creation, and IRB funding in safe order", async () => {
    const result = await plan();
    expect(result.status).toBe("READY_FOR_OWNER_REVIEW");
    expect(result.proposal.budget).toBe(parseUnits("3", 18));
    expect(result.proposal.maxRewardAmount).toBe(parseUnits("0.1", 18));
    expect(result.funding.oneRoundRequired).toBe(parseUnits("1", 18));
    expect(result.funding.totalRoundsRequired).toBe(parseUnits("3", 18));
    expect(result.funding.safetyBuffer).toBe(parseUnits("0.3", 18));
    expect(result.transactions.map((transaction) => transaction.kind)).toEqual([
      "TBNB_GAS_TOPUP",
      "CAMPAIGN_CREATE",
      "IRB_TRANSFER",
    ]);
    expect(result.transactions[1]).toMatchObject({
      requiredRole: "CAMPAIGN_MANAGER_ROLE",
      sender: TESTNET_OPERATIONS_ADDRESS,
    });
    expect(result.transactionsSent).toBe(0);
  });

  it("fails closed when the ACTIVE wallet count is not exactly ten", async () => {
    const result = await plan({ walletCount: 9 });
    expect(result.blockers).toContain("ACTIVE_WALLET_COUNT_MISMATCH");
  });

  it("presents no private or signed transaction material", async () => {
    const output = JSON.stringify(presentCampaignCreationPlan(await plan()));
    for (const secretName of [
      "privateKey",
      "private_key",
      "mnemonic",
      "rawTransaction",
      "signedTransaction",
    ]) {
      expect(output).not.toContain(secretName);
    }
    expect(output).toContain('"transactionsSent":0');
  });
});
