import "dotenv/config";

import { formatEther, formatUnits } from "ethers";

import {
  REWARD_CONTRACT_IRB_TARGET,
  TEST_CAMPAIGN_ID,
} from "../campaign/campaign-execution-plan.js";
import { loadEnvironment } from "../config/environment.js";
import {
  AURIX_REWARD_CONTRACT_ADDRESS,
  TESTNET_OPERATIONS_ADDRESS,
} from "../config/constants.js";
import { createCampaignExecutionCommandContext } from "./campaign-execution-command-context.js";
import { runCommand } from "./run-command.js";

await runCommand("campaign:status:test", async () => {
  const config = loadEnvironment();
  const context = await createCampaignExecutionCommandContext(config, false);
  try {
    const [campaign, rewardContractIrb, operationsTbnb, evidence] = await Promise.all([
      context.rewardClient.getCampaign(TEST_CAMPAIGN_ID),
      context.irbClient.balanceOf(AURIX_REWARD_CONTRACT_ADDRESS),
      context.primaryProvider.getBalance(TESTNET_OPERATIONS_ADDRESS),
      context.evidenceRepository?.listAll() ?? Promise.resolve([]),
    ]);
    return {
      campaign: {
        active: campaign.active,
        budgetBaseUnits: campaign.budget.toString(),
        budgetIrb: formatUnits(campaign.budget, 18),
        claimIntervalSeconds: campaign.claimInterval.toString(),
        distributedBaseUnits: campaign.distributed.toString(),
        distributedIrb: formatUnits(campaign.distributed, 18),
        endTime: campaign.endTime.toString(),
        exists: campaign.exists,
        maxRewardAmountBaseUnits: campaign.maxRewardAmount.toString(),
        maxRewardAmountIrb: formatUnits(campaign.maxRewardAmount, 18),
        startTime: campaign.startTime.toString(),
      },
      campaignId: TEST_CAMPAIGN_ID,
      evidence: evidence.map((operation) => ({
        blockNumber: operation.blockNumber ?? null,
        expectedSender: operation.expectedSender,
        feePaidTbnb: operation.feePaidWei === undefined
          ? null
          : formatEther(operation.feePaidWei),
        operationId: operation.operationId,
        operationType: operation.operationType,
        status: operation.status,
        txHash: operation.broadcastTxHash ?? operation.signedTxHash,
      })),
      operationsTbnb: formatEther(operationsTbnb),
      operationsTbnbWei: operationsTbnb.toString(),
      rewardContractIrb: formatUnits(rewardContractIrb, 18),
      rewardContractIrbBaseUnits: rewardContractIrb.toString(),
      rewardContractInventoryTargetBaseUnits: REWARD_CONTRACT_IRB_TARGET.toString(),
      status: campaign.exists ? "FOUND" : "CAMPAIGN_NOT_FOUND",
      transactionsSent: 0,
    };
  } finally {
    await context.close();
  }
});
