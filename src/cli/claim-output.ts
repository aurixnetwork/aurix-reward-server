import { formatEther, formatUnits } from "ethers";

import type { ClaimJobRecord, ClaimPlan } from "../claim/claim-types.js";

export function presentClaimPlan(plan: ClaimPlan): Record<string, unknown> {
  return {
    authorizationJobId: plan.authorization.jobId,
    authorizationStatus: plan.authorization.status,
    authorizationValidity: {
      deadline: plan.authorization.deadline.toString(),
      latestBlockTimestamp: plan.latestBlockTimestamp.toString(),
      validAfter: plan.authorization.validAfter.toString(),
    },
    blockers: plan.blockers,
    campaign: plan.authorization.campaignId,
    claimant: plan.authorization.claimant,
    currentEthereumTxNonce: plan.currentEthereumTxNonce,
    estimatedClaimGas: plan.estimatedGas?.toString(),
    estimatedFeeTbnb: plan.estimatedFeeWei === undefined
      ? undefined
      : formatEther(plan.estimatedFeeWei),
    estimatedFeeWei: plan.estimatedFeeWei?.toString(),
    expectedAction: plan.expectedAction,
    gasLimit: plan.gasLimit?.toString(),
    gasPriceWei: plan.gasPriceWei?.toString(),
    rewardAmountIrb: formatUnits(plan.authorization.amount, 18),
    rewardAmountWei: plan.authorization.amount.toString(),
    rewardContractIrbBalance: formatUnits(plan.rewardContractIrbBalance, 18),
    rewardId: plan.authorization.rewardId,
    rewardNonce: plan.authorization.rewardNonce.toString(),
    transactionsSent: 0,
    userGasBalanceTbnb: formatEther(plan.userGasBalanceWei),
    userGasBalanceWei: plan.userGasBalanceWei.toString(),
    userIrbBalance: formatUnits(plan.irbBalance, 18),
  };
}

export function presentClaimJob(job: ClaimJobRecord): Record<string, unknown> {
  return {
    amountIrb: formatUnits(job.amount, 18),
    amountWei: job.amount.toString(),
    authorizationJobId: job.authorizationJobId,
    balanceChanges: {
      rewardContractAfter: job.rewardContractBalanceAfter?.toString(),
      rewardContractBefore: job.rewardContractBalanceBefore.toString(),
      userAfter: job.irbBalanceAfter?.toString(),
      userBefore: job.irbBalanceBefore.toString(),
    },
    blockNumber: job.blockNumber,
    campaignId: job.campaignId,
    claimant: job.claimant,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    feePaidWei: job.feePaidWei?.toString(),
    gasUsed: job.gasUsed?.toString(),
    jobId: job.jobId,
    rewardClaimedEvent: job.rewardClaimedEvent
      ? {
          ...job.rewardClaimedEvent,
          amount: job.rewardClaimedEvent.amount.toString(),
          claimTimestamp: job.rewardClaimedEvent.claimTimestamp.toString(),
          consumedRewardNonce: job.rewardClaimedEvent.consumedRewardNonce.toString(),
        }
      : undefined,
    rewardClaimedEventValidated: job.rewardClaimedEventValidated,
    rewardId: job.rewardId,
    rewardNonce: job.rewardNonce.toString(),
    status: job.status,
    transactionHash: job.broadcastTxHash ?? job.signedTxHash,
    txNonce: job.txNonce,
  };
}
