import "dotenv/config";

import { createFundingPlan } from "../funding/funding-plan.js";
import { createFundingCommandContext } from "./funding-command-context.js";
import { presentFundingPlan } from "./funding-output.js";
import { runCommand } from "./run-command.js";

await runCommand("funding:plan:test", async () => {
  const context = await createFundingCommandContext();
  try {
    const plan = await createFundingPlan({
      fundingWalletAddress: context.funding.address,
      maxGasPriceWei: context.funding.maxGasPriceWei,
      provider: context.primaryProvider,
      repository: context.fundingRepository,
      targetBalanceWei: context.funding.targetBalanceWei,
      wallets: context.wallets,
    });
    return presentFundingPlan(plan);
  } finally {
    await context.close();
  }
});
