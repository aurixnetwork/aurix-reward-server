import "dotenv/config";

import { createRpcProviderPool } from "../blockchain/rpc-provider.js";
import { loadEnvironment } from "../config/environment.js";
import { runCommand } from "./run-command.js";

await runCommand("health:testnet", async () => {
  const config = loadEnvironment();
  const pool = createRpcProviderPool(config);
  try {
    const connected = await pool.connect();
    const healthyCount = connected.probes.filter((probe) => probe.healthy).length;
    return {
      chainId: config.rpc.expectedChainId,
      configuredEndpointCount: connected.probes.length,
      databaseConfigured: config.database !== undefined,
      endpoints: connected.probes,
      healthyEndpointCount: healthyCount,
      selectedEndpoint: connected.endpoint.label,
      status:
        healthyCount === connected.probes.length ? "healthy" : "degraded",
      transactionsSent: 0,
    };
  } finally {
    pool.destroy();
  }
});
