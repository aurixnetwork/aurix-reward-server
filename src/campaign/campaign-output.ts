import { formatEther, formatUnits } from "ethers";

import type { CampaignCreationPlan } from "./campaign-plan.js";

export function presentCampaignCreationPlan(plan: CampaignCreationPlan): object {
  return {
    activeWalletCount: plan.activeWalletCount,
    balances: {
      admin: formatBalance(plan.balances.adminIrb, plan.balances.adminTbnb),
      approver: { irb: formatUnits(plan.balances.approverIrb, 18), irbBaseUnits: plan.balances.approverIrb.toString() },
      operations: formatBalance(plan.balances.operationsIrb, plan.balances.operationsTbnb),
      rewardContract: { irb: formatUnits(plan.balances.rewardContractIrb, 18), irbBaseUnits: plan.balances.rewardContractIrb.toString() },
      tokenOwner: formatBalance(plan.balances.tokenOwnerIrb, plan.balances.tokenOwnerTbnb),
    },
    blockNumber: plan.blockNumber,
    blockers: plan.blockers,
    campaignExists: plan.campaignExists,
    chainId: plan.chainId,
    contractPaused: plan.contractPaused,
    funding: {
      oneRoundIrb: formatUnits(plan.funding.oneRoundRequired, 18),
      oneRoundRequiredBaseUnits: plan.funding.oneRoundRequired.toString(),
      recommendedContractBalanceBaseUnits: plan.funding.recommendedContractBalance.toString(),
      recommendedContractBalanceIrb: formatUnits(plan.funding.recommendedContractBalance, 18),
      requiredTopUpBaseUnits: plan.funding.requiredTopUp.toString(),
      requiredTopUpIrb: formatUnits(plan.funding.requiredTopUp, 18),
      safetyBufferBaseUnits: plan.funding.safetyBuffer.toString(),
      safetyBufferIrb: formatUnits(plan.funding.safetyBuffer, 18),
      totalRoundsBaseUnits: plan.funding.totalRoundsRequired.toString(),
      totalRoundsIrb: formatUnits(plan.funding.totalRoundsRequired, 18),
    },
    gasPriceGwei: formatUnits(plan.gasPriceWei, "gwei"),
    gasPriceWei: plan.gasPriceWei.toString(),
    intervalBoundsSeconds: {
      maximum: plan.intervalBounds.maximum.toString(),
      minimum: plan.intervalBounds.minimum.toString(),
    },
    proposal: {
      active: plan.proposal.active,
      budgetBaseUnits: plan.proposal.budget.toString(),
      budgetIrb: formatUnits(plan.proposal.budget, 18),
      campaignId: plan.proposal.campaignId,
      claimIntervalSeconds: plan.proposal.claimInterval.toString(),
      durationSeconds: plan.proposal.duration.toString(),
      endTime: plan.proposal.endTime.toString(),
      label: plan.proposal.label,
      maxRewardAmountBaseUnits: plan.proposal.maxRewardAmount.toString(),
      maxRewardAmountIrb: formatUnits(plan.proposal.maxRewardAmount, 18),
      rounds: plan.proposal.rounds,
      startTime: plan.proposal.startTime.toString(),
      walletCount: plan.proposal.walletCount,
    },
    proposalStatus: plan.proposalStatus,
    roles: plan.roles,
    status: plan.status,
    tokenOwner: plan.tokenOwner,
    totalEstimatedGas: plan.totalEstimatedGas.toString(),
    totalEstimatedGasFeeTbnb: formatEther(plan.totalEstimatedGasFeeWei),
    totalEstimatedGasFeeWei: plan.totalEstimatedGasFeeWei.toString(),
    transactions: plan.transactions.map((transaction) => ({
      ...(transaction.amountWei === undefined
        ? {}
        : {
            tokenAmountBaseUnits: transaction.amountWei.toString(),
            tokenAmountIrb: formatUnits(transaction.amountWei, 18),
          }),
      estimatedFeeTbnb: formatEther(transaction.estimatedFeeWei),
      estimatedFeeWei: transaction.estimatedFeeWei.toString(),
      estimatedGas: transaction.estimatedGas.toString(),
      expectedEvent: transaction.expectedEvent,
      expectedStateChange: transaction.expectedStateChange,
      function: transaction.function,
      kind: transaction.kind,
      nativeValueTbnb: formatEther(transaction.nativeValueWei),
      nativeValueWei: transaction.nativeValueWei.toString(),
      order: transaction.order,
      requiredRole: transaction.requiredRole,
      sender: transaction.sender,
      senderSufficient: transaction.senderSufficient,
      to: transaction.to,
    })),
    transactionsSent: plan.transactionsSent,
  };
}

function formatBalance(irb: bigint, tbnb: bigint): object {
  return {
    irb: formatUnits(irb, 18),
    irbBaseUnits: irb.toString(),
    tBNB: formatEther(tbnb),
    tBNBWei: tbnb.toString(),
  };
}
