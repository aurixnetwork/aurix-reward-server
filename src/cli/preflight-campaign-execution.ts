import "dotenv/config";

import { createCampaignExecutionPreflight } from "../campaign/campaign-execution-plan.js";
import { presentCampaignExecutionPreflight } from "../campaign/campaign-execution-output.js";
import { loadEnvironment } from "../config/environment.js";
import { createCampaignExecutionCommandContext } from "./campaign-execution-command-context.js";
import { runCommand } from "./run-command.js";

await runCommand("campaign:execute:preflight:test", async () => {
  const config = loadEnvironment();
  const context = await createCampaignExecutionCommandContext(config, false);
  try {
    return presentCampaignExecutionPreflight(await createCampaignExecutionPreflight({
      campaignConfig: config.campaignExecution,
      irbClient: context.irbClient,
      provider: context.primaryProvider,
      rewardClient: context.rewardClient,
    }));
  } finally {
    await context.close();
  }
});
