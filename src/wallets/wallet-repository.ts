import { getAddress } from "ethers";
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import type {
  EncryptedWalletRecord,
  NewEncryptedWallet,
  PublicWalletRecord,
  WalletStatus,
} from "./wallet-types.js";

interface WalletRow extends RowDataPacket {
  readonly created_at: Date;
  readonly encrypted_private_key: string;
  readonly encryption_auth_tag: string;
  readonly encryption_iv: string;
  readonly encryption_key_version: number;
  readonly id: number | string;
  readonly status: WalletStatus;
  readonly updated_at: Date;
  readonly wallet_address: string;
}

interface PublicWalletRow extends RowDataPacket {
  readonly created_at: Date;
  readonly id: number | string;
  readonly status: WalletStatus;
  readonly wallet_address: string;
}

export interface WalletRepository {
  findEncryptedById(id: string): Promise<EncryptedWalletRecord | undefined>;
  findPublicById(id: string): Promise<PublicWalletRecord | undefined>;
  insert(wallet: NewEncryptedWallet): Promise<EncryptedWalletRecord>;
  listActiveEncrypted(): Promise<readonly EncryptedWalletRecord[]>;
  listPublic(): Promise<readonly PublicWalletRecord[]>;
  updateStatus(id: string, status: WalletStatus): Promise<boolean>;
  withTransaction<T>(
    action: (repository: WalletRepository) => Promise<T>,
  ): Promise<T>;
}

export class DuplicateWalletAddressError extends Error {
  public constructor() {
    super("A wallet with this address already exists");
    this.name = "DuplicateWalletAddressError";
  }
}

type SqlExecutor = Pick<PoolConnection, "execute">;

export class MySqlWalletRepository implements WalletRepository {
  private constructor(
    private readonly executor: SqlExecutor,
    private readonly pool?: Pool,
  ) {}

  public static create(pool: Pool): MySqlWalletRepository {
    return new MySqlWalletRepository(pool, pool);
  }

  public async findEncryptedById(
    id: string,
  ): Promise<EncryptedWalletRecord | undefined> {
    const [rows] = await this.executor.execute<WalletRow[]>(
      `SELECT id, wallet_address, encrypted_private_key, encryption_iv,
              encryption_auth_tag, encryption_key_version, status,
              created_at, updated_at
         FROM reward_user_wallets
        WHERE id = ?`,
      [id],
    );
    const row = rows[0];
    return row ? mapEncryptedRow(row) : undefined;
  }

  public async findPublicById(
    id: string,
  ): Promise<PublicWalletRecord | undefined> {
    const [rows] = await this.executor.execute<PublicWalletRow[]>(
      `SELECT id, wallet_address, status, created_at
         FROM reward_user_wallets
        WHERE id = ?`,
      [id],
    );
    const row = rows[0];
    return row ? mapPublicRow(row) : undefined;
  }

  public async insert(wallet: NewEncryptedWallet): Promise<EncryptedWalletRecord> {
    try {
      const [result] = await this.executor.execute<ResultSetHeader>(
        `INSERT INTO reward_user_wallets
           (wallet_address, encrypted_private_key, encryption_iv,
            encryption_auth_tag, encryption_key_version, status)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          getAddress(wallet.walletAddress),
          wallet.encryptedPrivateKey,
          wallet.encryptionIv,
          wallet.encryptionAuthTag,
          wallet.encryptionKeyVersion,
          wallet.status,
        ],
      );
      const saved = await this.findEncryptedById(String(result.insertId));
      if (!saved) {
        throw new Error("Inserted wallet record could not be reloaded");
      }
      return saved;
    } catch (error: unknown) {
      if (isDuplicateEntryError(error)) {
        throw new DuplicateWalletAddressError();
      }
      throw error;
    }
  }

  public async listActiveEncrypted(): Promise<readonly EncryptedWalletRecord[]> {
    const [rows] = await this.executor.execute<WalletRow[]>(
      `SELECT id, wallet_address, encrypted_private_key, encryption_iv,
              encryption_auth_tag, encryption_key_version, status,
              created_at, updated_at
         FROM reward_user_wallets
        WHERE status = 'ACTIVE'
        ORDER BY id`,
    );
    return rows.map(mapEncryptedRow);
  }

  public async listPublic(): Promise<readonly PublicWalletRecord[]> {
    const [rows] = await this.executor.execute<PublicWalletRow[]>(
      `SELECT id, wallet_address, status, created_at
         FROM reward_user_wallets
        ORDER BY id`,
    );
    return rows.map(mapPublicRow);
  }

  public async updateStatus(id: string, status: WalletStatus): Promise<boolean> {
    const [result] = await this.executor.execute<ResultSetHeader>(
      "UPDATE reward_user_wallets SET status = ? WHERE id = ?",
      [status, id],
    );
    return result.affectedRows === 1;
  }

  public async withTransaction<T>(
    action: (repository: WalletRepository) => Promise<T>,
  ): Promise<T> {
    if (!this.pool) {
      return action(this);
    }

    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await action(new MySqlWalletRepository(connection));
      await connection.commit();
      return result;
    } catch (error: unknown) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}

function mapEncryptedRow(row: WalletRow): EncryptedWalletRecord {
  return {
    createdAt: new Date(row.created_at),
    encryptedPrivateKey: row.encrypted_private_key,
    encryptionAuthTag: row.encryption_auth_tag,
    encryptionIv: row.encryption_iv,
    encryptionKeyVersion: row.encryption_key_version,
    id: String(row.id),
    status: row.status,
    updatedAt: new Date(row.updated_at),
    walletAddress: getAddress(row.wallet_address),
  };
}

function mapPublicRow(row: PublicWalletRow): PublicWalletRecord {
  return {
    createdAt: new Date(row.created_at),
    id: String(row.id),
    status: row.status,
    walletAddress: getAddress(row.wallet_address),
  };
}

function isDuplicateEntryError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ER_DUP_ENTRY"
  );
}
