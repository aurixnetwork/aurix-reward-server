import { formatEther, formatUnits } from "ethers";

import type { RewardRun, RewardRunItem, WalletExecutionResult } from "./production-types.js";

export function formatWalletResult(
  item: RewardRunItem,
  result: WalletExecutionResult,
  processed: number,
  target: number,
  at: Date = new Date(),
): string {
  const lines = [
    "------------------------------------------------------------",
    `[${at.toISOString()}]`,
    `Run: ${item.runId}`,
    `Campaign: ${item.campaignName}`,
    `Progress: ${processed} / ${target}`,
    "",
    `Wallet ID: ${item.walletId}`,
    `Address: ${item.claimant}`,
    `Action: ${result.action}`,
  ];
  if (result.action === "CLAIM_CONFIRMED") {
    lines.push(`Reward: ${formatUnits(item.rewardAmount, 18)} AURX`);
    if (result.rewardNonce !== undefined) lines.push(`Reward Nonce: ${result.rewardNonce}`);
    if (result.transactionHash) lines.push(`TX: ${result.transactionHash}`);
    if (result.actualGasWei !== undefined) lines.push(`Gas: ${formatEther(result.actualGasWei)} BNB`);
  } else {
    lines.push(`Transactions Sent: ${result.transactionsSent}`);
    if (result.blockerCode) lines.push(`Blocker: ${result.blockerCode}`);
    if (result.errorCode) lines.push(`Error: ${result.errorCode}`);
  }
  lines.push("------------------------------------------------------------");
  return lines.join("\n");
}

export function presentFinalRunSummary(run: RewardRun): Record<string, unknown> {
  const completed = run.completedAt?.getTime();
  const started = run.startedAt?.getTime();
  return {
    runId: run.runId,
    campaign: run.campaignName,
    policy: run.campaignPolicy,
    target: run.targetWalletCount,
    processed: run.processedCount,
    confirmed: run.confirmedCount,
    alreadyRewarded: run.alreadyRewardedCount,
    skipped: run.skippedCount,
    blocked: run.blockedCount,
    reconciliationRequired: run.reconciliationRequiredCount,
    failed: run.failedCount,
    transactionsSent: run.transactionsSent,
    totalAurxDistributed: formatUnits(run.totalReward, 18),
    totalBnbGas: formatEther(run.totalGas),
    dispatchIntervalSeconds: run.dispatchIntervalSeconds,
    startedAt: run.startedAt?.toISOString(),
    completedAt: run.completedAt?.toISOString(),
    durationSeconds: completed !== undefined && started !== undefined ? (completed - started) / 1_000 : undefined,
    finalStatus: run.status,
  };
}

export function formatFinalRunSummary(run: RewardRun): string {
  const summary = presentFinalRunSummary(run);
  return [
    "============================================================",
    "FINAL RUN SUMMARY",
    ...Object.entries(summary).map(([key, value]) => `${key}: ${formatSummaryValue(value)}`),
    "============================================================",
  ].join("\n");
}

function formatSummaryValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return JSON.stringify(value);
}

export function createDappBayEvidence(input: {
  readonly run: RewardRun;
  readonly chainId: number;
  readonly rewardContract: string;
  readonly distinctClaimantCount: number;
  readonly transactions: readonly { readonly hash: string; readonly blockNumber: number; readonly rewardNonce: bigint }[];
}) {
  return {
    runId: input.run.runId,
    chainId: input.chainId,
    rewardContract: input.rewardContract,
    campaignId: input.run.campaignId,
    policy: input.run.campaignPolicy,
    dispatchIntervalSeconds: input.run.dispatchIntervalSeconds,
    requestedWalletCount: input.run.targetWalletCount,
    distinctClaimantCount: input.distinctClaimantCount,
    confirmedClaims: input.run.confirmedCount,
    transactions: input.transactions.map((transaction) => ({ ...transaction, rewardNonce: transaction.rewardNonce.toString() })),
    rewardAmountWei: input.run.rewardAmount.toString(),
    totalAurxWei: input.run.totalReward.toString(),
    totalBnbGasWei: input.run.totalGas.toString(),
    startedAt: input.run.startedAt?.toISOString(),
    completedAt: input.run.completedAt?.toISOString(),
  };
}
