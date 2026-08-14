import "dotenv/config";

import {
  collectTestnetSnapshot,
  createPreflightReport,
} from "../blockchain/preflight.js";
import { createRpcProviderPool } from "../blockchain/rpc-provider.js";
import { loadEnvironment } from "../config/environment.js";
import { runCommand } from "./run-command.js";

await runCommand("preflight:testnet", async () => {
  const config = loadEnvironment();
  const pool = createRpcProviderPool(config);
  try {
    const connected = await pool.connect();
    const snapshot = await collectTestnetSnapshot(
      connected.endpoint.provider,
      config,
    );
    return createPreflightReport(
      snapshot,
      config,
      connected.endpoint.label,
      connected.probes,
    );
  } finally {
    pool.destroy();
  }
});
