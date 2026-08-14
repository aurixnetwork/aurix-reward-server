import type { JsonRpcProvider } from "ethers";
import type { Pool } from "mysql2/promise";

import {
  collectTestnetSnapshot,
  validateTestnetSnapshot,
} from "../blockchain/preflight.js";
import { createRpcProviderPool, type RpcProviderPool } from "../blockchain/rpc-provider.js";
import {
  loadEnvironment,
  requireFundingConfig,
  type FundingConfig,
} from "../config/environment.js";
import { createDatabasePool } from "../database/pool.js";
import { MySqlFundingRepository } from "../funding/funding-repository.js";
import { FundingReadFailoverProvider } from "../funding/funding-rpc.js";
import type { FundingProvider, FundingWalletTarget } from "../funding/funding-types.js";
import { MySqlWalletRepository } from "../wallets/wallet-repository.js";

export interface FundingCommandContext {
  readonly close: () => Promise<void>;
  readonly funding: FundingConfig;
  readonly fundingRepository: MySqlFundingRepository;
  readonly primaryProvider: FundingProvider;
  readonly providers: readonly FundingProvider[];
  readonly rpcPool: RpcProviderPool<JsonRpcProvider>;
  readonly wallets: readonly FundingWalletTarget[];
}

export async function createFundingCommandContext(): Promise<FundingCommandContext> {
  const config = loadEnvironment();
  const funding = requireFundingConfig(config);
  if (!config.database) {
    throw new Error("Database configuration is required for funding commands");
  }
  const databasePool = createDatabasePool(config.database);
  const rpcPool = createRpcProviderPool(config);
  try {
    await databasePool.query("SELECT 1");
    const connected = await rpcPool.connect();
    const snapshot = await collectTestnetSnapshot(connected.endpoint.provider, config);
    validateTestnetSnapshot(snapshot, config);
    const publicWallets = await MySqlWalletRepository.create(databasePool).listPublic();
    const wallets = publicWallets
      .filter((wallet) => wallet.status === "ACTIVE")
      .map((wallet) => ({ id: wallet.id, walletAddress: wallet.walletAddress }));
    const providers = connected.healthyEndpoints.map(
      (endpoint) => endpoint.provider as unknown as FundingProvider,
    );
    return {
      close: async () => {
        rpcPool.destroy();
        await databasePool.end();
      },
      funding,
      fundingRepository: new MySqlFundingRepository(databasePool),
      primaryProvider: new FundingReadFailoverProvider(providers),
      providers,
      rpcPool,
      wallets,
    };
  } catch (error: unknown) {
    rpcPool.destroy();
    await databasePool.end();
    throw error;
  }
}

export async function createFundingStatusContext(): Promise<{
  readonly pool: Pool;
  readonly repository: MySqlFundingRepository;
}> {
  const config = loadEnvironment();
  if (!config.database) throw new Error("Database configuration is required");
  const pool = createDatabasePool(config.database);
  try {
    await pool.query("SELECT 1");
    return { pool, repository: new MySqlFundingRepository(pool) };
  } catch (error: unknown) {
    await pool.end();
    throw error;
  }
}
