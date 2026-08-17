import { Wallet } from "ethers";
import { describe, expect, it, vi } from "vitest";

import { loadMainnetEnvironment } from "../src/config/mainnet-environment.js";
import { calculateGasReadiness } from "../src/production/gas-readiness.js";
import { calculateInventoryReadiness } from "../src/production/inventory-readiness.js";
import { calculateMainnetReadiness } from "../src/production/mainnet-readiness.js";
import { createRewardPlan, ProductionLimitError } from "../src/production/reward-planning.js";
import { EMPTY_RUN_COUNTERS, applyWalletResult } from "../src/production/run-accounting.js";
import { presentFinalRunSummary } from "../src/production/run-output.js";
import type { RewardRun } from "../src/production/production-types.js";
import { importMainnetWallets } from "../src/production/wallet-import.js";

const limits = { maxAggregateRewardPerRun: 100n, maxRewardPerWallet: 10n, maxTransactionsPerRun: 100, maxWalletsPerRun: 100 };

describe("production planning and readiness", () => {
  it("blocks an inactive Campaign in readiness", () => {
    const report = calculateMainnetReadiness(loadMainnetEnvironment({ NETWORK_PROFILE: "MAINNET" }), observations());
    expect(report.campaignReady).toBe(false);
    expect(report.overallReady).toBe(false);
  });

  it("detects Campaign budget exhaustion", () => {
    const inventory = calculateInventoryReadiness([{ active: true, budget: 10n, campaignId: "A", distributed: 10n }], 0n);
    expect(inventory.campaignRemaining[0]?.remaining).toBe(0n);
  });

  it("detects Reward Contract inventory shortage", () => {
    expect(calculateInventoryReadiness([{ active: true, budget: 100n, campaignId: "A", distributed: 0n }], 99n).status).toBe("INVENTORY_RISK");
  });

  it("aggregates multiple active Campaign liabilities", () => {
    const report = calculateInventoryReadiness([
      { active: true, budget: 100n, campaignId: "A", distributed: 10n },
      { active: true, budget: 50n, campaignId: "B", distributed: 25n },
      { active: false, budget: 1_000n, campaignId: "C", distributed: 0n },
    ], 80n);
    expect(report.aggregateActiveLiability).toBe(115n);
    expect(report.deficit).toBe(35n);
  });

  it("enforces max Wallets per Run", () => {
    expect(() => createRewardPlan({ limits, rewardAmountPerWallet: 1n, walletCount: 101 })).toThrow(new ProductionLimitError("MAX_WALLETS_PER_RUN_EXCEEDED"));
  });

  it("enforces max transactions per Run", () => {
    expect(() => createRewardPlan({ limits: { ...limits, maxTransactionsPerRun: 9 }, rewardAmountPerWallet: 1n, walletCount: 10 })).toThrow("MAX_TRANSACTIONS_PER_RUN_EXCEEDED");
  });

  it("enforces max reward per Wallet", () => {
    expect(() => createRewardPlan({ limits, rewardAmountPerWallet: 11n, walletCount: 1 })).toThrow("MAX_REWARD_PER_WALLET_EXCEEDED");
  });

  it("enforces max aggregate reward", () => {
    expect(() => createRewardPlan({ limits, rewardAmountPerWallet: 2n, walletCount: 51 })).toThrow("MAX_AGGREGATE_REWARD_PER_RUN_EXCEEDED");
  });

  it("creates a 5-wallet Canary Plan without transactions", () => {
    expect(createRewardPlan({ limits, rewardAmountPerWallet: 1n, walletCount: 5 })).toMatchObject({ kind: "CANARY_5", transactionsSent: 0 });
  });

  it("creates a 10-wallet Canary Plan", () => {
    expect(createRewardPlan({ limits, rewardAmountPerWallet: 1n, walletCount: 10 }).kind).toBe("CANARY_10");
  });

  it("creates a 100-wallet DappBay Pilot Plan", () => {
    expect(createRewardPlan({ limits, rewardAmountPerWallet: 1n, walletCount: 100 }).kind).toBe("PILOT_100");
  });

  it("includes optional AURX inventory buffer", () => {
    expect(createRewardPlan({ inventoryBuffer: 20n, limits, rewardAmountPerWallet: 1n, walletCount: 5 }).rewardContractInventoryRequired).toBe(25n);
  });

  it("reports gas capacity without funding", () => {
    const report = calculateGasReadiness({ estimatedClaimGas: 100_000n, gasPriceWei: 3_000_000_000n, wallets: [{ address: "0x1", balanceWei: 0n, walletId: "1" }] });
    expect(report.feePerWalletWei).toBe(300_000_000_000_000n);
    expect(report.aggregateFundingRequirementWei).toBe(report.feePerWalletWei);
    expect(report.transactionsSent).toBe(0);
  });

  it("calculates 5, 10, and 100 Wallet gas estimates", () => {
    const report = calculateGasReadiness({ estimatedClaimGas: 1n, gasPriceWei: 2n, wallets: [] });
    expect([report.canary5EstimateWei, report.canary10EstimateWei, report.pilot100EstimateWei]).toEqual([10n, 20n, 200n]);
  });

  it("rejects duplicate Wallet imports before plaintext can be persisted", async () => {
    const wallet = Wallet.createRandom();
    const repository = { existsByAddress: vi.fn().mockResolvedValue(true), insertManyMainnet: vi.fn() };
    await expect(importMainnetWallets([{ privateKey: wallet.privateKey }], repository, { key: Buffer.alloc(32, 1), version: 1 })).rejects.toThrow("DUPLICATE_WALLET");
    expect(repository.insertManyMainnet).not.toHaveBeenCalled();
  });

  it("rejects a derived-address mismatch", async () => {
    const wallet = Wallet.createRandom();
    const repository = { existsByAddress: vi.fn(), insertManyMainnet: vi.fn() };
    await expect(importMainnetWallets([{ expectedAddress: Wallet.createRandom().address, privateKey: wallet.privateKey }], repository, { key: Buffer.alloc(32, 1), version: 1 })).rejects.toThrow("DERIVED_ADDRESS_MISMATCH");
  });

  it("imports only encrypted key material", async () => {
    const wallet = Wallet.createRandom();
    const insertManyMainnet = vi.fn().mockImplementation((records: readonly { walletAddress: string }[]) => Promise.resolve(records.map((record) => ({ id: "1", walletAddress: record.walletAddress }))));
    await importMainnetWallets([{ privateKey: wallet.privateKey }], { existsByAddress: vi.fn().mockResolvedValue(false), insertManyMainnet }, { key: Buffer.alloc(32, 1), version: 1 });
    const persisted = (insertManyMainnet.mock.calls[0]?.[0] as readonly Record<string, unknown>[])[0];
    expect(persisted).not.toHaveProperty("privateKey");
    expect(JSON.stringify(persisted)).not.toContain(wallet.privateKey);
  });

  it("produces an aggregate-only final Summary", () => {
    const summary = presentFinalRunSummary(run());
    expect(summary).toMatchObject({ confirmed: 10, processed: 10, runId: "RUN-1" });
    expect(summary).not.toHaveProperty("items");
  });

  it("simulates exact 1,000-wallet accounting", () => {
    let counters = EMPTY_RUN_COUNTERS;
    for (let index = 0; index < 1_000; index += 1) counters = applyWalletResult(counters, { action: "CLAIM_CONFIRMED", classification: "CONFIRMED", transactionsSent: 1 }, 3n);
    expect(counters).toMatchObject({ confirmed: 1_000, processed: 1_000, totalReward: 3_000n, transactionsSent: 1_000 });
  });

  it("simulates 10,000 immediately durable counter updates without retaining Items", () => {
    let counters = EMPTY_RUN_COUNTERS;
    for (let index = 0; index < 10_000; index += 1) counters = applyWalletResult(counters, { action: "CLAIM_CONFIRMED", classification: "CONFIRMED", transactionsSent: 1 }, 1n);
    expect(counters.processed).toBe(10_000);
    expect(Object.keys(counters)).not.toContain("items");
  });
});

function observations() {
  return {
    aurxCodePresent: false, campaignReady: false, databaseReady: false, dispatcherReady: false,
    durableRunsReady: false, gasReady: false, inventoryReady: false, migrationReady: false,
    multiCampaignReady: false, pauseResumeReady: false, walletCount: 0, walletLockReady: false,
  };
}

function run(): RewardRun {
  return {
    alreadyRewardedCount: 0, blockedCount: 0, campaignId: "0x1", campaignName: "Initial",
    campaignPolicy: "FIRST_REWARD_ONLY", confirmedCount: 10, createdAt: new Date(0),
    currentSequence: 10, dispatchIntervalSeconds: 10, failedCount: 0, processedCount: 10,
    reconciliationRequiredCount: 0, rewardAmount: 1n, runId: "RUN-1", skippedCount: 0,
    status: "COMPLETED", targetWalletCount: 10, totalGas: 100n, totalReward: 10n,
    transactionsSent: 10, startedAt: new Date(0), completedAt: new Date(10_000),
  };
}
