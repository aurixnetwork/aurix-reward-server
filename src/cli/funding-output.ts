import { formatEther, formatUnits } from "ethers";

import type { FundingJobRecord, FundingJobStatus, FundingPlan } from "../funding/funding-types.js";

export function presentFundingPlan(plan: FundingPlan) {
  return {
    chainId: plan.chainId,
    estimatedGasRequirementTbnb: formatEther(plan.estimatedGasCostWei),
    fundingWalletAddress: plan.fundingWalletAddress,
    fundingWalletBalanceTbnb: formatEther(plan.fundingWalletBalanceWei),
    gasPriceGwei: formatUnits(plan.feeDataGasPriceWei, "gwei"),
    gasPriceWithinMaximum: plan.gasPriceWithinMaximum,
    sufficientFundingBalance: plan.sufficientFundingBalance,
    totalRequiredTbnb: formatEther(plan.totalRequiredWei),
    totalTopUpRequiredTbnb: formatEther(plan.totalTopUpRequiredWei),
    transactionsPlanned: plan.transactionsPlanned,
    transactionsSent: 0,
    wallets: plan.wallets.map((wallet) => ({
      action: wallet.action,
      currentBalanceTbnb: formatEther(wallet.balanceBeforeWei),
      id: wallet.id,
      targetTbnb: formatEther(wallet.targetBalanceWei),
      topUpRequiredTbnb: formatEther(wallet.fundingAmountWei),
      walletAddress: wallet.walletAddress,
    })),
  };
}

export function presentFundingStatus(jobs: readonly FundingJobRecord[]) {
  const statuses: readonly FundingJobStatus[] = [
    "PLANNED", "SIGNED", "BROADCAST", "CONFIRMED", "SKIPPED", "FAILED", "PENDING_REVIEW",
  ];
  const counts = Object.fromEntries(
    statuses.map((status) => [status.toLowerCase(), jobs.filter((job) => job.status === status).length]),
  );
  return {
    counts: { total: jobs.length, ...counts },
    jobs: jobs.map((job) => ({
      amountTbnb: formatEther(job.fundingAmountWei),
      block: job.blockNumber ?? null,
      feeTbnb: job.feePaidWei === undefined ? null : formatEther(job.feePaidWei),
      jobId: job.jobId,
      status: job.status,
      txHash: job.broadcastTxHash ?? job.signedTxHash ?? null,
      wallet: job.walletAddress,
    })),
  };
}
