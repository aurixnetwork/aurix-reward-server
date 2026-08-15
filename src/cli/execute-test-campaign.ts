import "dotenv/config";

import { executeTestCampaignWorkflow } from "../campaign/campaign-execution-service.js";
import {
  loadEnvironment,
} from "../config/environment.js";
import { createCampaignExecutionCommandContext } from "./campaign-execution-command-context.js";
import { runCommand } from "./run-command.js";

await runCommand("campaign:execute:test", async () => {
  const environment = loadEnvironment();
  if (!environment.campaignExecution.executionEnabled) {
    throw new Error("Campaign execution refused: CAMPAIGN_EXECUTION_ENABLED must equal true");
  }
  const context = await createCampaignExecutionCommandContext(environment, true);
  try {
    if (!context.evidenceRepository) throw new Error("Campaign evidence repository is unavailable");
    return await executeTestCampaignWorkflow({
      broadcastProviders: context.providers,
      config: environment.campaignExecution,
      irbClient: context.irbClient,
      primaryProvider: context.primaryProvider,
      repository: context.evidenceRepository,
      rewardClient: context.rewardClient,
    });
  } finally {
    await context.close();
  }
});
