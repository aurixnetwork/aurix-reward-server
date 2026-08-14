import "dotenv/config";

import { createRpcProviderPool } from "../blockchain/rpc-provider.js";
import { loadEnvironment } from "../config/environment.js";
import { IrbTokenClient } from "../contracts/irb-token-client.js";
import { runCommand } from "./run-command.js";

await runCommand("inspect:irb:testnet", async () => {
  const config = loadEnvironment();
  const pool = createRpcProviderPool(config);
  try {
    const connected = await pool.connect();
    const provider = connected.endpoint.provider;
    const client = new IrbTokenClient(provider, config.contracts.irbTokenAddress);
    const [code, inspection] = await Promise.all([
      provider.getCode(config.contracts.irbTokenAddress),
      client.inspect(),
    ]);

    return {
      address: config.contracts.irbTokenAddress,
      chainId: config.rpc.expectedChainId,
      codeSizeBytes: code === "0x" ? 0 : (code.length - 2) / 2,
      inspection,
      rpcEndpoint: connected.endpoint.label,
      transactionsSent: 0,
    };
  } finally {
    pool.destroy();
  }
});
