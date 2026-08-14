import "dotenv/config";

import { executeFundingBatch } from "../funding/funding-service.js";
import { createFundingCommandContext } from "./funding-command-context.js";
import { runCommand } from "./run-command.js";

await runCommand("funding:execute:test", async () => {
  const context = await createFundingCommandContext();
  try {
    if (!context.funding.executionEnabled) {
      throw new Error(
        "Funding execution refused: FUNDING_EXECUTION_ENABLED must equal true",
      );
    }
    return await executeFundingBatch({
      broadcastProviders: context.providers,
      executionEnabled: context.funding.executionEnabled,
      fundingPrivateKey: context.funding.privateKey,
      maxGasPriceWei: context.funding.maxGasPriceWei,
      primaryProvider: context.primaryProvider,
      repository: context.fundingRepository,
      targetBalanceWei: context.funding.targetBalanceWei,
      wallets: context.wallets,
    });
  } finally {
    await context.close();
  }
});
