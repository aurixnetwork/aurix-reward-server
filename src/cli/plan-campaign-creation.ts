import "dotenv/config";

import { createTestCampaignCreationPlan } from "../campaign/campaign-plan.js";
import { presentCampaignCreationPlan } from "../campaign/campaign-output.js";
import { createCampaignPlanCommandContext } from "./campaign-plan-command-context.js";
import { runCommand } from "./run-command.js";

await runCommand("campaign:plan:create:test", async () => {
  const context = await createCampaignPlanCommandContext();
  try {
    const plan = await createTestCampaignCreationPlan({
      activeWalletCount: context.activeWalletCount,
      irbClient: context.irbClient,
      provider: context.provider,
      rewardClient: context.rewardClient,
    });
    return presentCampaignCreationPlan(plan);
  } finally {
    await context.close();
  }
});
