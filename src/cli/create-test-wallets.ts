import "dotenv/config";

import { parseTestWalletCount } from "../wallets/test-wallet-count.js";
import { createWalletCommandContext } from "./wallet-command-context.js";
import { runCommand } from "./run-command.js";

await runCommand("wallets:create:test", async () => {
  const count = parseTestWalletCount(process.argv.slice(2));
  const context = await createWalletCommandContext();
  try {
    const wallets = await context.service.createTestWallets(count);
    return wallets;
  } finally {
    await context.pool.end();
  }
});
