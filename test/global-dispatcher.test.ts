/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from "vitest";

import {
  dispatchOne,
  ethereumNonceRequiresWalletLease,
  policyAllowsConcurrentRewardNonce,
  selectOldestDueCampaign,
  type DispatcherRepository,
  type ProductionClaimExecutor,
} from "../src/production/global-dispatcher.js";
import type { Lease, RewardRunItem, WalletExecutionResult } from "../src/production/production-types.js";

const now = new Date("2026-08-18T01:00:00.000Z");
const lease: Lease = { expiresAt: new Date(now.getTime() + 60_000), ownerId: "worker-1", token: "lease-token" };
const item: RewardRunItem = {
  campaignId: `0x${"11".repeat(32)}`, campaignName: "INITIAL_REWARD", chainId: 56,
  claimant: "0x0000000000000000000000000000000000000001", classification: "PENDING",
  id: "1", lifecycleState: "PENDING", policy: "FIRST_REWARD_ONLY", policyScope: "AURIX_INITIAL_V1",
  rewardAmount: 100_000_000_000_000_000n, runId: "MAINNET-INITIAL-001", sequence: 1, walletId: "1",
};
const confirmed: WalletExecutionResult = {
  action: "CLAIM_CONFIRMED", actualGasWei: 10_000_000_000_000n, classification: "CONFIRMED",
  rewardNonce: 0n, transactionHash: `0x${"ab".repeat(32)}`, transactionsSent: 1,
};

function repository(overrides: Partial<DispatcherRepository> = {}): DispatcherRepository {
  return {
    acquireDispatcherLease: vi.fn().mockResolvedValue(lease),
    releaseDispatcherLease: vi.fn().mockResolvedValue(undefined),
    acquireWalletLease: vi.fn().mockResolvedValue(lease),
    releaseWalletLease: vi.fn().mockResolvedValue(undefined),
    findRecoveryItem: vi.fn().mockResolvedValue(undefined),
    findOldestDueItem: vi.fn().mockResolvedValue(item),
    markItemAcquired: vi.fn().mockResolvedValue(true),
    finalizeItem: vi.fn().mockResolvedValue({ processed: 1, target: 100 }),
    findRun: vi.fn().mockResolvedValue(undefined),
    hasConfirmedFirstReward: vi.fn().mockResolvedValue(false),
    hasConfirmedCampaignReward: vi.fn().mockResolvedValue(false),
    hasUnresolvedReward: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

function executor(result: WalletExecutionResult = confirmed): ProductionClaimExecutor {
  return { execute: vi.fn().mockResolvedValue(result), reconcile: vi.fn().mockResolvedValue(result) };
}

describe("durable global dispatcher", () => {
  it("keeps rewardNonce isolated by campaign and claimant", () => {
    expect(policyAllowsConcurrentRewardNonce(
      { campaignId: "A", claimant: item.claimant }, { campaignId: "B", claimant: item.claimant },
    )).toBe(true);
    expect(policyAllowsConcurrentRewardNonce(
      { campaignId: "A", claimant: item.claimant }, { campaignId: "A", claimant: item.claimant },
    )).toBe(false);
  });

  it("treats Ethereum nonce as Wallet-global across Campaigns", () => {
    expect(ethereumNonceRequiresWalletLease({ claimant: item.claimant }, { claimant: item.claimant.toUpperCase() })).toBe(true);
  });

  it("protects the same Wallet across Campaigns with a durable lease", async () => {
    const repo = repository({ acquireWalletLease: vi.fn().mockResolvedValue(undefined) });
    expect((await dispatchOne({ dispatcherLeaseSeconds: 60, executor: executor(), ownerId: "worker-1", repository: repo, walletLeaseSeconds: 60 })).status).toBe("WALLET_BUSY");
  });

  it("allows stale lease recovery through a newly acquired token", async () => {
    const recovered = { ...lease, token: "new-token" };
    const repo = repository({ acquireWalletLease: vi.fn().mockResolvedValue(recovered) });
    expect((await dispatchOne({ dispatcherLeaseSeconds: 60, executor: executor(), ownerId: "worker-1", repository: repo, walletLeaseSeconds: 60 })).status).toBe("DISPATCHED");
    expect(repo.releaseWalletLease).toHaveBeenCalledWith(item, recovered);
  });

  it("selects multiple active Campaigns by oldest due time", () => {
    const selected = selectOldestDueCampaign([
      { id: "A", nextDispatchAt: new Date(now.getTime() - 10_000) },
      { id: "B", nextDispatchAt: new Date(now.getTime() - 30_000) },
      { id: "C", nextDispatchAt: new Date(now.getTime() + 10_000) },
    ], now);
    expect(selected?.id).toBe("B");
  });

  it("keeps independent dispatch intervals as due timestamps", () => {
    const a = new Date(now.getTime() + 10_000);
    const b = new Date(now.getTime() + 30_000);
    expect(b.getTime() - a.getTime()).toBe(20_000);
  });

  it("does not select a Campaign before nextDispatchAt", () => {
    expect(selectOldestDueCampaign([{ id: "A", nextDispatchAt: new Date(now.getTime() + 1) }], now)).toBeUndefined();
  });

  it("uses deterministic Campaign fairness for equal due time", () => {
    expect(selectOldestDueCampaign([{ id: "B" }, { id: "A" }], now)?.id).toBe("A");
  });

  it("enforces global concurrency one with the dispatcher lease", async () => {
    const repo = repository({ acquireDispatcherLease: vi.fn().mockResolvedValue(undefined) });
    expect((await dispatchOne({ dispatcherLeaseSeconds: 60, executor: executor(), ownerId: "worker-2", repository: repo, walletLeaseSeconds: 60 })).status).toBe("LEASE_BUSY");
    expect(repo.findOldestDueItem).not.toHaveBeenCalled();
  });

  it("dispatches exactly one Item per invocation", async () => {
    const run = executor();
    await dispatchOne({ dispatcherLeaseSeconds: 60, executor: run, ownerId: "worker-1", repository: repository(), walletLeaseSeconds: 60 });
    expect(run.execute).toHaveBeenCalledOnce();
  });

  it("persists a Wallet result before immediate console output", async () => {
    const order: string[] = [];
    const repo = repository({ finalizeItem: vi.fn().mockImplementation(() => { order.push("db"); return Promise.resolve({ processed: 1, target: 100 }); }) });
    await dispatchOne({ dispatcherLeaseSeconds: 60, executor: executor(), ownerId: "worker-1", output: () => order.push("console"), repository: repo, walletLeaseSeconds: 60 });
    expect(order).toEqual(["db", "console"]);
  });

  it("prints CLAIM_CONFIRMED immediately", async () => {
    const output = vi.fn();
    await dispatchOne({ dispatcherLeaseSeconds: 60, executor: executor(), ownerId: "worker-1", output, repository: repository(), walletLeaseSeconds: 60 });
    expect(output.mock.calls[0]?.[0]).toContain("Action: CLAIM_CONFIRMED");
  });

  it("prints SKIP_ALREADY_REWARDED with zero transactions", async () => {
    const output = vi.fn();
    await dispatchOne({ dispatcherLeaseSeconds: 60, executor: executor(), ownerId: "worker-1", output, repository: repository({ hasConfirmedFirstReward: vi.fn().mockResolvedValue(true) }), walletLeaseSeconds: 60 });
    expect(output.mock.calls[0]?.[0]).toContain("Action: SKIP_ALREADY_REWARDED");
    expect(output.mock.calls[0]?.[0]).toContain("Transactions Sent: 0");
  });

  it("prints blocked results immediately", async () => {
    const output = vi.fn();
    const result: WalletExecutionResult = { action: "BLOCKED_INSUFFICIENT_GAS", blockerCode: "LOW_BNB", classification: "BLOCKED", transactionsSent: 0 };
    await dispatchOne({ dispatcherLeaseSeconds: 60, executor: executor(result), ownerId: "worker-1", output, repository: repository(), walletLeaseSeconds: 60 });
    expect(output.mock.calls[0]?.[0]).toContain("BLOCKED_INSUFFICIENT_GAS");
  });

  it("prints reconciliation results immediately", async () => {
    const output = vi.fn();
    await dispatchOne({ dispatcherLeaseSeconds: 60, executor: executor(), ownerId: "worker-1", output, repository: repository({ hasUnresolvedReward: vi.fn().mockResolvedValue(true) }), walletLeaseSeconds: 60 });
    expect(output.mock.calls[0]?.[0]).toContain("RECONCILIATION_REQUIRED");
  });

  it("pauses by returning no due work", async () => {
    const repo = repository({ findOldestDueItem: vi.fn().mockResolvedValue(undefined) });
    expect((await dispatchOne({ dispatcherLeaseSeconds: 60, executor: executor(), ownerId: "worker-1", repository: repo, walletLeaseSeconds: 60 })).status).toBe("IDLE");
  });

  it("resume skips confirmed FIRST_REWARD history", async () => {
    const run = executor();
    await dispatchOne({ dispatcherLeaseSeconds: 60, executor: run, ownerId: "worker-1", repository: repository({ hasConfirmedFirstReward: vi.fn().mockResolvedValue(true) }), walletLeaseSeconds: 60 });
    expect(run.execute).not.toHaveBeenCalled();
  });

  it.each(["ACQUIRED", "AUTHORIZED", "SIGNED", "BROADCAST", "PENDING_REVIEW"] as const)(
    "routes crash recovery state %s through reconciliation before retry", async (lifecycleState) => {
      const recovery = { ...item, lifecycleState };
      const run = executor();
      await dispatchOne({ dispatcherLeaseSeconds: 60, executor: run, ownerId: "worker-1", repository: repository({ findRecoveryItem: vi.fn().mockResolvedValue(recovery) }), walletLeaseSeconds: 60 });
      expect(run.reconcile).toHaveBeenCalledWith(recovery);
      expect(run.execute).not.toHaveBeenCalled();
    },
  );

  it("turns unexpected exceptions into secret-safe SYSTEM_ERROR", async () => {
    const output = vi.fn();
    const run: ProductionClaimExecutor = { execute: vi.fn().mockRejectedValue(new Error("private-key-value")), reconcile: vi.fn() };
    const response = await dispatchOne({ dispatcherLeaseSeconds: 60, executor: run, ownerId: "worker-1", output, repository: repository(), walletLeaseSeconds: 60 });
    expect(response.result?.errorCode).toBe("DISPATCH_SYSTEM_ERROR");
    expect(output.mock.calls[0]?.[0]).not.toContain("private-key-value");
  });
});
