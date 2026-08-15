import type { JsonRpcProvider } from "ethers";
import type { Pool } from "mysql2/promise";

import { collectTestnetSnapshot, validateTestnetSnapshot } from "../blockchain/preflight.js";
import { createRpcProviderPool, type RpcProviderPool } from "../blockchain/rpc-provider.js";
import { MySqlCampaignEvidenceRepository } from "../campaign/campaign-evidence-repository.js";
import { CampaignReadFailoverProvider } from "../campaign/campaign-rpc.js";
import type { CampaignExecutionProvider } from "../campaign/campaign-execution-types.js";
import type { AppConfig } from "../config/environment.js";
import { IrbTokenClient } from "../contracts/irb-token-client.js";
import { RewardContractClient } from "../contracts/reward-contract-client.js";
import { createDatabasePool } from "../database/pool.js";

export interface CampaignExecutionCommandContext {
  readonly close: () => Promise<void>;
  readonly evidenceRepository: MySqlCampaignEvidenceRepository | undefined;
  readonly irbClient: IrbTokenClient;
  readonly primaryProvider: CampaignExecutionProvider;
  readonly providers: readonly CampaignExecutionProvider[];
  readonly rewardClient: RewardContractClient;
  readonly rpcPool: RpcProviderPool<JsonRpcProvider>;
}

export async function createCampaignExecutionCommandContext(
  config: AppConfig,
  requireDatabase: boolean,
): Promise<CampaignExecutionCommandContext> {
  if (requireDatabase && !config.database) {
    throw new Error("Database configuration is required for campaign execution evidence");
  }
  const databasePool: Pool | undefined = config.database
    ? createDatabasePool(config.database)
    : undefined;
  const rpcPool = createRpcProviderPool(config);
  try {
    await databasePool?.query("SELECT 1");
    const connected = await rpcPool.connect();
    const snapshot = await collectTestnetSnapshot(connected.endpoint.provider, config);
    validateTestnetSnapshot(snapshot, config);
    const providers = connected.healthyEndpoints.map(
      (endpoint) => endpoint.provider as unknown as CampaignExecutionProvider,
    );
    return {
      close: async () => {
        rpcPool.destroy();
        await databasePool?.end();
      },
      evidenceRepository: databasePool
        ? new MySqlCampaignEvidenceRepository(databasePool)
        : undefined,
      irbClient: new IrbTokenClient(
        connected.endpoint.provider,
        config.contracts.irbTokenAddress,
      ),
      primaryProvider: new CampaignReadFailoverProvider(providers),
      providers,
      rewardClient: new RewardContractClient(
        connected.endpoint.provider,
        config.contracts.rewardContractAddress,
      ),
      rpcPool,
    };
  } catch (error: unknown) {
    rpcPool.destroy();
    await databasePool?.end();
    throw error;
  }
}
