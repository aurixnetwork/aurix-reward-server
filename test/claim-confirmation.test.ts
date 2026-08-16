import { parseEther, Wallet } from "ethers";
import { describe, expect, it, vi } from "vitest";

import type { AuthorizationJobRecord } from "../src/authorization/authorization-types.js";
import {
  ClaimConfirmationError,
  validateConfirmedClaim,
} from "../src/claim/claim-confirmation.js";
import { rewardClaimInterface } from "../src/claim/claim-codec.js";
import type {
  ClaimChainReader,
  ClaimReceipt,
  ClaimTokenReader,
} from "../src/claim/claim-types.js";
import { AURIX_REWARD_CONTRACT_ADDRESS } from "../src/config/constants.js";

const claimant = new Wallet(`0x${"44".repeat(32)}`).address;
const approver = new Wallet(`0x${"55".repeat(32)}`).address;
const amount = parseEther("0.1");
const campaignId = `0x${"11".repeat(32)}`;
const rewardId = `0x${"22".repeat(32)}`;
const authorization: AuthorizationJobRecord = {
  amount,
  approverAddress: approver,
  approverSignature: `0x${"33".repeat(65)}`,
  campaignId,
  claimant,
  deadline: 3_000n,
  jobId: "0d4ebebf-82f2-4d1a-a7df-c09a4db256ae",
  rewardId,
  rewardNonce: 7n,
  status: "READY",
  typedDataHash: `0x${"99".repeat(32)}`,
  validAfter: 1_000n,
  walletId: "1",
};
const before = {
  campaignDistributedBefore: 0n,
  irbBalanceBefore: 0n,
  rewardContractBalanceBefore: parseEther("3.3"),
  signedTxHash: `0x${"77".repeat(32)}`,
};

describe("claim confirmation", () => {
  it("accepts only an exact RewardClaimed event and exact post-state", async () => {
    const result = await validateConfirmedClaim(fixture());
    expect(result.event).toMatchObject({ amount, approver, campaignId, claimant, rewardId });
    expect(result.postState).toMatchObject({
      campaignDistributedAfter: amount,
      irbBalanceAfter: amount,
      rewardContractBalanceAfter: parseEther("3.2"),
      rewardIdUsed: true,
      rewardNonceAfter: 8n,
    });
  });

  it("rejects a reverted receipt before event validation", async () => {
    const input = fixture();
    await expect(validateConfirmedClaim({
      ...input,
      receipt: { ...input.receipt, status: 0 },
    })).rejects.toMatchObject({ code: "TRANSACTION_REVERTED" });
  });

  it("rejects a RewardClaimed event with the wrong claimant", async () => {
    const input = fixture({ eventClaimant: new Wallet(`0x${"66".repeat(32)}`).address });
    await expect(validateConfirmedClaim(input)).rejects.toMatchObject({ code: "EVENT_CLAIMANT_MISMATCH" });
  });

  it("rejects a RewardClaimed event with the wrong amount", async () => {
    const input = fixture({ eventAmount: amount - 1n });
    await expect(validateConfirmedClaim(input)).rejects.toMatchObject({ code: "EVENT_AMOUNT_MISMATCH" });
  });

  it("rejects a successful receipt with no matching event", async () => {
    const input = fixture();
    await expect(validateConfirmedClaim({
      ...input,
      receipt: { ...input.receipt, logs: [] },
    })).rejects.toBeInstanceOf(ClaimConfirmationError);
  });

  it("rejects balance evidence that does not match the exact transfer", async () => {
    const input = fixture({ userBalanceAfter: amount - 1n });
    await expect(validateConfirmedClaim(input)).rejects.toMatchObject({ code: "USER_IRB_BALANCE_MISMATCH" });
  });
});

function fixture(options: {
  readonly eventAmount?: bigint;
  readonly eventClaimant?: string;
  readonly userBalanceAfter?: bigint;
} = {}) {
  const timestamp = 2_100n;
  const event = rewardClaimInterface.encodeEventLog(
    rewardClaimInterface.getEvent("RewardClaimed"),
    [
      campaignId,
      rewardId,
      options.eventClaimant ?? claimant,
      approver,
      options.eventAmount ?? amount,
      7n,
      timestamp,
    ],
  );
  const receipt: ClaimReceipt = {
    blockNumber: 123,
    gasPrice: 3_000_000_000n,
    gasUsed: 90_000n,
    hash: `0x${"77".repeat(32)}`,
    logs: [{
      address: AURIX_REWARD_CONTRACT_ADDRESS,
      data: event.data,
      index: 0,
      topics: event.topics,
    }],
    status: 1,
  };
  const reader: ClaimChainReader = {
    getCampaign: vi.fn().mockResolvedValue({
      active: true, budget: parseEther("3"), claimInterval: 3_600n,
      distributed: amount, endTime: 4_000n, exists: true,
      maxRewardAmount: amount, startTime: 100n,
    }),
    getClaimantState: vi.fn().mockResolvedValue({
      claimIntervalElapsed: false,
      lastClaimAt: timestamp,
      nextClaimAt: timestamp + 3_600n,
      rewardNonce: 8n,
    }),
    getRewardToken: vi.fn(),
    hasApproverRole: vi.fn(),
    isPaused: vi.fn(),
    isRewardIdUsed: vi.fn().mockResolvedValue(true),
  };
  const token: ClaimTokenReader = {
    balanceOf: vi.fn((address: string) => Promise.resolve(
      address === claimant
        ? (options.userBalanceAfter ?? amount)
        : parseEther("3.2"))),
  };
  return {
    authorization,
    expectedApprover: approver,
    job: before,
    reader,
    receipt,
    rewardContractAddress: AURIX_REWARD_CONTRACT_ADDRESS,
    token,
  };
}
