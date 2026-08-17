import { formatEther, formatUnits } from "ethers";

import type { BatchRunResult, BatchWalletItem } from "./batch-types.js";

export function presentBatchRun(result: BatchRunResult): Record<string, unknown> {
  return {
    actualGasTbnb: formatEther(result.actualGasWei),
    actualGasWei: result.actualGasWei.toString(),
    batchRunId: result.batchRunId,
    blocked: result.blocked,
    campaignId: result.campaignId,
    completedAt: result.completedAt,
    concurrency: result.concurrency,
    confirmed: result.confirmed,
    estimatedGasTbnb: formatEther(result.estimatedGasWei),
    estimatedGasWei: result.estimatedGasWei.toString(),
    failed: result.failed,
    items: result.items.map(presentBatchItem),
    mode: result.mode,
    processed: result.processed,
    reconciliationRequired: result.reconciliationRequired,
    requestedWallets: result.requestedWallets,
    skipped: result.skipped,
    startedAt: result.startedAt,
    status: result.status,
    ...(result.systemError ? { systemError: result.systemError } : {}),
    totalRewardIrb: formatUnits(result.totalRewardAmount, 18),
    totalRewardWei: result.totalRewardAmount.toString(),
    transactionsSent: result.transactionsSent,
    walletRange: {
      end: result.walletIdEnd,
      start: result.walletIdStart,
    },
  };
}

function presentBatchItem(item: BatchWalletItem): Record<string, unknown> {
  return {
    action: item.action,
    actualFeeTbnb: item.actualFeeWei === undefined
      ? undefined
      : formatEther(item.actualFeeWei),
    actualFeeWei: item.actualFeeWei?.toString(),
    authorizationJobId: item.authorizationJobId,
    blockers: item.blockers,
    campaignRemainingBudgetIrb: item.campaignRemainingBudget === undefined
      ? undefined
      : formatUnits(item.campaignRemainingBudget, 18),
    campaignRemainingBudgetWei: item.campaignRemainingBudget?.toString(),
    claimJobId: item.claimJobId,
    claimant: item.claimant,
    classification: item.classification,
    estimatedFeeTbnb: item.estimatedFeeWei === undefined
      ? undefined
      : formatEther(item.estimatedFeeWei),
    estimatedFeeWei: item.estimatedFeeWei?.toString(),
    irbBalance: item.irbBalance === undefined
      ? undefined
      : formatUnits(item.irbBalance, 18),
    nextClaimAt: item.nextClaimAt?.toString(),
    rewardContractIrbBalance: item.rewardContractIrbBalance === undefined
      ? undefined
      : formatUnits(item.rewardContractIrbBalance, 18),
    rewardNonce: item.rewardNonce?.toString(),
    safeError: item.safeError,
    transactionHash: item.transactionHash,
    transactionsSent: item.transactionsSent,
    userGasBalanceTbnb: item.userGasBalanceWei === undefined
      ? undefined
      : formatEther(item.userGasBalanceWei),
    userGasBalanceWei: item.userGasBalanceWei?.toString(),
    walletId: item.walletId,
  };
}
