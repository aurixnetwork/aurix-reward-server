import { describe, expect, it, vi } from "vitest";

import {
  ClaimChainReadFailover,
  ClaimReadFailoverProvider,
  ClaimTokenReadFailover,
} from "../src/claim/claim-rpc.js";
import type {
  ClaimChainReader,
  ClaimProvider,
  ClaimTokenReader,
} from "../src/claim/claim-types.js";

describe("claim RPC failover", () => {
  it("falls back for provider reads without broadcasting", async () => {
    const primary = provider(new Error("primary unavailable"));
    const secondary = provider(9n);
    const failover = new ClaimReadFailoverProvider([primary, secondary]);
    expect(await failover.getBalance("0x0000000000000000000000000000000000000001")).toBe(9n);
    expect(primary.broadcastSpy).not.toHaveBeenCalled();
    expect(secondary.broadcastSpy).not.toHaveBeenCalled();
  });

  it("falls back independently for Reward Contract and IRB reads", async () => {
    const failingReader = reader(new Error("primary unavailable"));
    const workingReader = reader(true);
    const chain = new ClaimChainReadFailover([failingReader, workingReader]);
    const token = new ClaimTokenReadFailover([
      { balanceOf: vi.fn().mockRejectedValue(new Error("primary unavailable")) },
      { balanceOf: vi.fn().mockResolvedValue(11n) },
    ] satisfies ClaimTokenReader[]);
    expect(await chain.isRewardIdUsed(`0x${"11".repeat(32)}`)).toBe(true);
    expect(await token.balanceOf("0x0000000000000000000000000000000000000001")).toBe(11n);
  });
});

function provider(balance: bigint | Error): ClaimProvider & {
  readonly broadcastSpy: ReturnType<typeof vi.fn>;
} {
  const broadcastSpy = vi.fn();
  return {
    broadcastSpy,
    broadcastTransaction: broadcastSpy,
    estimateGas: vi.fn(),
    getBalance: balance instanceof Error
      ? vi.fn().mockRejectedValue(balance)
      : vi.fn().mockResolvedValue(balance),
    getBlock: vi.fn(),
    getCode: vi.fn(),
    getFeeData: vi.fn(),
    getNetwork: vi.fn(),
    getTransaction: vi.fn(),
    getTransactionCount: vi.fn(),
    getTransactionReceipt: vi.fn(),
  };
}

function reader(used: boolean | Error): ClaimChainReader {
  return {
    getCampaign: vi.fn(),
    getClaimantState: vi.fn(),
    getRewardToken: vi.fn(),
    hasApproverRole: vi.fn(),
    isPaused: vi.fn(),
    isRewardIdUsed: used instanceof Error
      ? vi.fn().mockRejectedValue(used)
      : vi.fn().mockResolvedValue(used),
  };
}
