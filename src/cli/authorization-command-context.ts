import type { JsonRpcProvider } from "ethers";
import type { Pool } from "mysql2/promise";

import {
  collectTestnetSnapshot,
  validateTestnetSnapshot,
} from "../blockchain/preflight.js";
import { createRpcProviderPool, type RpcProviderPool } from "../blockchain/rpc-provider.js";
import {
  loadEnvironment,
  requireApproverConfig,
  requireAuthorizationPolicy,
  type ApproverConfig,
  type AuthorizationPolicyConfig,
} from "../config/environment.js";
import { RewardContractClient } from "../contracts/reward-contract-client.js";
import { createDatabasePool } from "../database/pool.js";
import { MySqlAuthorizationRepository } from "../authorization/authorization-repository.js";
import { MySqlWalletRepository } from "../wallets/wallet-repository.js";

export interface AuthorizationCommandContext {
  readonly approver?: ApproverConfig;
  readonly close: () => Promise<void>;
  readonly expectedApproverAddress: string;
  readonly policy?: AuthorizationPolicyConfig;
  readonly pool: Pool;
  readonly reader: RewardContractClient;
  readonly repository: MySqlAuthorizationRepository;
  readonly rpcPool: RpcProviderPool<JsonRpcProvider>;
  readonly walletRepository: MySqlWalletRepository;
}

export async function createAuthorizationCommandContext(options: {
  readonly requireApprover?: boolean;
  readonly requirePolicy?: boolean;
} = {}): Promise<AuthorizationCommandContext> {
  const config = loadEnvironment();
  if (!config.database) throw new Error("Database configuration is required for authorization commands");
  const policy = options.requirePolicy ? requireAuthorizationPolicy(config) : undefined;
  const approver = options.requireApprover ? requireApproverConfig(config) : undefined;
  const pool = createDatabasePool(config.database);
  const rpcPool = createRpcProviderPool(config);
  try {
    await pool.query("SELECT 1");
    const connected = await rpcPool.connect();
    const snapshot = await collectTestnetSnapshot(connected.endpoint.provider, config);
    validateTestnetSnapshot(snapshot, config);
    return {
      ...(approver ? { approver } : {}),
      close: async () => {
        rpcPool.destroy();
        await pool.end();
      },
      expectedApproverAddress: config.authorization.approverExpectedAddress,
      ...(policy ? { policy } : {}),
      pool,
      reader: new RewardContractClient(
        connected.endpoint.provider,
        config.contracts.rewardContractAddress,
      ),
      repository: new MySqlAuthorizationRepository(pool),
      rpcPool,
      walletRepository: MySqlWalletRepository.create(pool),
    };
  } catch (error: unknown) {
    rpcPool.destroy();
    await pool.end();
    throw error;
  }
}

export async function createCampaignInspectContext(): Promise<{
  readonly close: () => void;
  readonly reader: RewardContractClient;
}> {
  const config = loadEnvironment();
  const rpcPool = createRpcProviderPool(config);
  try {
    const connected = await rpcPool.connect();
    const snapshot = await collectTestnetSnapshot(connected.endpoint.provider, config);
    validateTestnetSnapshot(snapshot, config);
    return {
      close: () => rpcPool.destroy(),
      reader: new RewardContractClient(
        connected.endpoint.provider,
        config.contracts.rewardContractAddress,
      ),
    };
  } catch (error: unknown) {
    rpcPool.destroy();
    throw error;
  }
}
