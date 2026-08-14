import "dotenv/config";

import { formatUnits } from "ethers";

import { parseCampaignInspectArgs } from "../authorization/authorization-cli-args.js";
import { createCampaignInspectContext } from "./authorization-command-context.js";
import { runCommand } from "./run-command.js";

await runCommand("campaign:inspect:test", async () => {
  const campaignId = parseCampaignInspectArgs(process.argv.slice(2));
  const context = await createCampaignInspectContext();
  try {
    const campaign = await context.reader.getCampaign(campaignId);
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
      campaignId,
      status: campaign.exists ? "FOUND" : "CAMPAIGN_NOT_FOUND",
      transactionsSent: 0,
    };
  } finally {
    context.close();
  }
});
