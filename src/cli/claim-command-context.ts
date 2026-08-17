import type { JsonRpcProvider } from "ethers";
import type { Pool } from "mysql2/promise";

import { MySqlAuthorizationRepository } from "../authorization/authorization-repository.js";
import { collectTestnetSnapshot, validateTestnetSnapshot } from "../blockchain/preflight.js";
import { createRpcProviderPool, type RpcProviderPool } from "../blockchain/rpc-provider.js";
import { MySqlClaimRepository } from "../claim/claim-repository.js";
import {
  ClaimChainReadFailover,
  ClaimReadFailoverProvider,
  ClaimTokenReadFailover,
} from "../claim/claim-rpc.js";
import type {
  ClaimChainReader,
  ClaimProvider,
  ClaimTokenReader,
} from "../claim/claim-types.js";
import { loadEnvironment, type AppConfig } from "../config/environment.js";
import { IrbTokenClient } from "../contracts/irb-token-client.js";
import { RewardContractClient } from "../contracts/reward-contract-client.js";
import { createDatabasePool } from "../database/pool.js";
import { MySqlWalletRepository } from "../wallets/wallet-repository.js";

export interface ClaimCommandContext {
  readonly authorizationReader: RewardContractClient;
  readonly authorizationRepository: MySqlAuthorizationRepository;
  readonly claimRepository: MySqlClaimRepository;
  readonly close: () => Promise<void>;
  readonly config: AppConfig;
  readonly pool: Pool;
  readonly primaryProvider: ClaimProvider;
  readonly providers: readonly ClaimProvider[];
  readonly reader: ClaimChainReader;
  readonly rpcPool: RpcProviderPool<JsonRpcProvider>;
  readonly token: ClaimTokenReader;
  readonly walletRepository: MySqlWalletRepository;
}

export async function createClaimCommandContext(
  config: AppConfig = loadEnvironment(),
): Promise<ClaimCommandContext> {
  if (!config.database) throw new Error("Database configuration is required for claim commands");
  const pool = createDatabasePool(config.database);
  const rpcPool = createRpcProviderPool(config);
  try {
    await pool.query("SELECT 1");
    const connected = await rpcPool.connect();
    const snapshot = await collectTestnetSnapshot(connected.endpoint.provider, config);
    validateTestnetSnapshot(snapshot, config);
    const providers = connected.healthyEndpoints.map(
      (endpoint) => endpoint.provider as unknown as ClaimProvider,
    );
    const authorizationReader = new RewardContractClient(
      connected.endpoint.provider,
      config.contracts.rewardContractAddress,
    );
    return {
      authorizationReader,
      authorizationRepository: new MySqlAuthorizationRepository(pool),
      claimRepository: new MySqlClaimRepository(pool),
      close: async () => {
        rpcPool.destroy();
        await pool.end();
      },
      config,
      pool,
      primaryProvider: new ClaimReadFailoverProvider(providers),
      providers,
      reader: new ClaimChainReadFailover(
        connected.healthyEndpoints.map((endpoint) =>
          new RewardContractClient(
            endpoint.provider,
            config.contracts.rewardContractAddress,
          )),
      ),
      rpcPool,
      token: new ClaimTokenReadFailover(
        connected.healthyEndpoints.map((endpoint) =>
          new IrbTokenClient(
            endpoint.provider,
            config.contracts.irbTokenAddress,
          )),
      ),
      walletRepository: MySqlWalletRepository.create(pool),
    };
  } catch (error: unknown) {
    rpcPool.destroy();
    await pool.end();
    throw error;
  }
}

export async function createClaimStatusContext(): Promise<{
  readonly pool: Pool;
  readonly repository: MySqlClaimRepository;
}> {
  const config = loadEnvironment();
  if (!config.database) throw new Error("Database configuration is required");
  const pool = createDatabasePool(config.database);
  try {
    await pool.query("SELECT 1");
    return { pool, repository: new MySqlClaimRepository(pool) };
  } catch (error: unknown) {
    await pool.end();
    throw error;
  }
}
