import "dotenv/config";

import { createRpcProviderPool } from "../blockchain/rpc-provider.js";
import { loadEnvironment } from "../config/environment.js";
import { RewardContractClient } from "../contracts/reward-contract-client.js";
import { runCommand } from "./run-command.js";

await runCommand("inspect:reward:testnet", async () => {
  const config = loadEnvironment();
  const pool = createRpcProviderPool(config);
  try {
    const connected = await pool.connect();
    const provider = connected.endpoint.provider;
    const client = new RewardContractClient(
      provider,
      config.contracts.rewardContractAddress,
    );
    const [code, inspection] = await Promise.all([
      provider.getCode(config.contracts.rewardContractAddress),
      client.inspect(),
    ]);

    return {
      address: config.contracts.rewardContractAddress,
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
