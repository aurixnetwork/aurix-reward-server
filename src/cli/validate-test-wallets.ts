import "dotenv/config";

import { WalletValidationCommandError } from "../wallets/wallet-errors.js";
import { createWalletCommandContext } from "./wallet-command-context.js";
import { runCommand } from "./run-command.js";

await runCommand("wallets:validate:test", async () => {
  const context = await createWalletCommandContext();
  try {
    const report = await context.service.validateActiveWallets();
    if (report.failed > 0) {
      throw new WalletValidationCommandError(report);
    }
    return report;
  } finally {
    await context.pool.end();
  }
});
