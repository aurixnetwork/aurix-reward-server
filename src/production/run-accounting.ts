import type { WalletExecutionResult } from "./production-types.js";

export interface RunCounters {
  readonly processed: number;
  readonly confirmed: number;
  readonly alreadyRewarded: number;
  readonly skipped: number;
  readonly blocked: number;
  readonly reconciliationRequired: number;
  readonly failed: number;
  readonly transactionsSent: number;
  readonly totalReward: bigint;
  readonly totalGas: bigint;
}

export const EMPTY_RUN_COUNTERS: RunCounters = {
  processed: 0, confirmed: 0, alreadyRewarded: 0, skipped: 0, blocked: 0,
  reconciliationRequired: 0, failed: 0, transactionsSent: 0, totalReward: 0n, totalGas: 0n,
};

export function applyWalletResult(
  counters: RunCounters, result: WalletExecutionResult, rewardAmount: bigint,
): RunCounters {
  const confirmed = result.classification === "CONFIRMED";
  const alreadyRewarded = result.action === "SKIP_ALREADY_REWARDED";
  return {
    processed: counters.processed + 1,
    confirmed: counters.confirmed + Number(confirmed),
    alreadyRewarded: counters.alreadyRewarded + Number(alreadyRewarded),
    skipped: counters.skipped + Number(result.classification === "SKIPPED" && !alreadyRewarded),
    blocked: counters.blocked + Number(result.classification === "BLOCKED"),
    reconciliationRequired: counters.reconciliationRequired + Number(result.classification === "RECONCILIATION_REQUIRED"),
    failed: counters.failed + Number(["FAILED", "SYSTEM_ERROR"].includes(result.classification)),
    transactionsSent: counters.transactionsSent + result.transactionsSent,
    totalReward: counters.totalReward + (confirmed ? rewardAmount : 0n),
    totalGas: counters.totalGas + (result.actualGasWei ?? 0n),
  };
}
