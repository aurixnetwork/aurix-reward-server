import "dotenv/config";

import { createWalletCommandContext } from "./wallet-command-context.js";
import { runCommand } from "./run-command.js";

await runCommand("wallets:list:test", async () => {
  const context = await createWalletCommandContext();
  try {
    const wallets = await context.service.listTestWallets();
    return {
      count: wallets.length,
      wallets: wallets.map((wallet) => ({
        createdAt: wallet.createdAt.toISOString(),
        id: wallet.id,
        status: wallet.status,
        walletAddress: wallet.walletAddress,
      })),
    };
  } finally {
    await context.pool.end();
  }
});
