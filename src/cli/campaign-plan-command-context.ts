import type { JsonRpcProvider } from "ethers";

import {
  collectTestnetSnapshot,
  validateTestnetSnapshot,
} from "../blockchain/preflight.js";
import { createRpcProviderPool, type RpcProviderPool } from "../blockchain/rpc-provider.js";
import { loadEnvironment } from "../config/environment.js";
import { IrbTokenClient } from "../contracts/irb-token-client.js";
import { RewardContractClient } from "../contracts/reward-contract-client.js";
import { createDatabasePool } from "../database/pool.js";
import { MySqlWalletRepository } from "../wallets/wallet-repository.js";

export interface CampaignPlanCommandContext {
  readonly activeWalletCount: number;
  readonly close: () => Promise<void>;
  readonly irbClient: IrbTokenClient;
  readonly provider: JsonRpcProvider;
  readonly rewardClient: RewardContractClient;
  readonly rpcPool: RpcProviderPool<JsonRpcProvider>;
}

export async function createCampaignPlanCommandContext(): Promise<CampaignPlanCommandContext> {
  const config = loadEnvironment();
  if (!config.database) {
    throw new Error("Database configuration is required to confirm the 10-wallet Testnet scope");
  }
  const databasePool = createDatabasePool(config.database);
  const rpcPool = createRpcProviderPool(config);
  try {
    await databasePool.query("SELECT 1");
    const connected = await rpcPool.connect();
    const provider = connected.endpoint.provider;
    const snapshot = await collectTestnetSnapshot(provider, config);
    validateTestnetSnapshot(snapshot, config);
    const wallets = await MySqlWalletRepository.create(databasePool).listPublic();
    return {
      activeWalletCount: wallets.filter((wallet) => wallet.status === "ACTIVE").length,
      close: async () => {
        rpcPool.destroy();
        await databasePool.end();
      },
      irbClient: new IrbTokenClient(provider, config.contracts.irbTokenAddress),
      provider,
      rewardClient: new RewardContractClient(provider, config.contracts.rewardContractAddress),
      rpcPool,
    };
  } catch (error: unknown) {
    rpcPool.destroy();
    await databasePool.end();
    throw error;
  }
}
