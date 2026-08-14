import type { Pool } from "mysql2/promise";

import {
  loadEnvironment,
  requireWalletEncryptionConfig,
} from "../config/environment.js";
import { createDatabasePool } from "../database/pool.js";
import { MySqlWalletRepository } from "../wallets/wallet-repository.js";
import { WalletService } from "../wallets/wallet-service.js";

export interface WalletCommandContext {
  readonly pool: Pool;
  readonly service: WalletService;
}

export async function createWalletCommandContext(): Promise<WalletCommandContext> {
  const config = loadEnvironment();
  const encryption = requireWalletEncryptionConfig(config);
  if (!config.database) {
    throw new Error(
      "Database configuration is required: set DB_HOST, DB_NAME, and DB_USER",
    );
  }

  const pool = createDatabasePool(config.database);
  try {
    await pool.query("SELECT 1");
    return {
      pool,
      service: new WalletService(MySqlWalletRepository.create(pool), encryption),
    };
  } catch (error: unknown) {
    await pool.end();
    throw error;
  }
}
