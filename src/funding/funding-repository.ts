import { getAddress } from "ethers";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

import type {
  FundingJobRecord,
  FundingJobStatus,
  FundingReceipt,
  SignedFundingJobInput,
  SkippedFundingJobInput,
} from "./funding-types.js";

const ACTIVE_STATUSES = ["SIGNED", "BROADCAST", "PENDING_REVIEW"] as const;

interface FundingJobRow extends RowDataPacket {
  readonly balance_before_wei: string;
  readonly block_number: number | string | null;
  readonly broadcast_tx_hash: string | null;
  readonly fee_paid_wei: string | null;
  readonly funding_amount_wei: string;
  readonly job_id: string;
  readonly signed_tx_hash: string | null;
  readonly status: FundingJobStatus;
  readonly wallet_address: string;
  readonly wallet_id: number | string;
}

export interface FundingRepository {
  findActiveByWalletAddresses(addresses: readonly string[]): Promise<readonly FundingJobRecord[]>;
  insertSigned(input: SignedFundingJobInput): Promise<void>;
  insertSkipped(input: SkippedFundingJobInput): Promise<void>;
  listJobs(): Promise<readonly FundingJobRecord[]>;
  listUnresolved(): Promise<readonly FundingJobRecord[]>;
  markBroadcast(jobId: string, hash: string): Promise<void>;
  markConfirmed(jobId: string, receipt: FundingReceipt, balanceAfterWei: bigint): Promise<void>;
  markFailed(jobId: string, code: string, message: string, receipt?: FundingReceipt): Promise<void>;
  markPendingReview(
    jobId: string,
    code: string,
    message: string,
    receipt?: FundingReceipt,
    balanceAfterWei?: bigint,
  ): Promise<void>;
}

export class ActiveFundingJobError extends Error {
  public constructor() {
    super("An unresolved funding job already exists for this wallet");
    this.name = "ActiveFundingJobError";
  }
}

export class MySqlFundingRepository implements FundingRepository {
  public constructor(private readonly pool: Pool) {}

  public async findActiveByWalletAddresses(
    addresses: readonly string[],
  ): Promise<readonly FundingJobRecord[]> {
    if (addresses.length === 0) return [];
    const placeholders = addresses.map(() => "?").join(",");
    const [rows] = await this.pool.execute<FundingJobRow[]>(
      `${selectColumns()} WHERE wallet_address IN (${placeholders})
         AND status IN ('SIGNED','BROADCAST','PENDING_REVIEW') ORDER BY id`,
      addresses.map(getAddress),
    );
    return rows.map(mapRow);
  }

  public async insertSigned(input: SignedFundingJobInput): Promise<void> {
    try {
      await this.pool.execute(
        `INSERT INTO reward_wallet_funding_jobs
          (job_id, wallet_id, wallet_address, network_chain_id,
           balance_before_wei, target_balance_wei, funding_amount_wei,
           funding_wallet_address, tx_nonce, gas_limit, signed_tx_hash, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SIGNED')`,
        [
          input.jobId, input.id, getAddress(input.walletAddress), input.networkChainId,
          input.balanceBeforeWei.toString(), input.targetBalanceWei.toString(),
          input.fundingAmountWei.toString(), getAddress(input.fundingWalletAddress),
          input.txNonce, input.gasLimit.toString(), input.signedTxHash,
        ],
      );
    } catch (error: unknown) {
      if (isDuplicateEntryError(error)) throw new ActiveFundingJobError();
      throw error;
    }
  }

  public async insertSkipped(input: SkippedFundingJobInput): Promise<void> {
    await this.pool.execute(
      `INSERT IGNORE INTO reward_wallet_funding_jobs
        (job_id, wallet_id, wallet_address, network_chain_id,
         balance_before_wei, target_balance_wei, funding_amount_wei,
         funding_wallet_address, status, status_reason)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'SKIPPED', ?)`,
      [
        input.jobId, input.id, getAddress(input.walletAddress), input.networkChainId,
        input.balanceBeforeWei.toString(), input.targetBalanceWei.toString(),
        getAddress(input.fundingWalletAddress), input.reason,
      ],
    );
  }

  public async listJobs(): Promise<readonly FundingJobRecord[]> {
    const [rows] = await this.pool.execute<FundingJobRow[]>(
      `${selectColumns()} ORDER BY id DESC`,
    );
    return rows.map(mapRow);
  }

  public async listUnresolved(): Promise<readonly FundingJobRecord[]> {
    const [rows] = await this.pool.execute<FundingJobRow[]>(
      `${selectColumns()} WHERE status IN ('SIGNED','BROADCAST','PENDING_REVIEW') ORDER BY id`,
    );
    return rows.map(mapRow);
  }

  public async markBroadcast(jobId: string, hash: string): Promise<void> {
    await updateExactlyOne(this.pool, `UPDATE reward_wallet_funding_jobs
       SET status = 'BROADCAST', broadcast_tx_hash = ?, broadcast_at = CURRENT_TIMESTAMP(6),
           error_code = NULL, error_message = NULL WHERE job_id = ?`, [hash, jobId]);
  }

  public async markConfirmed(
    jobId: string,
    receipt: FundingReceipt,
    balanceAfterWei: bigint,
  ): Promise<void> {
    const fee = receipt.gasUsed * receipt.gasPrice;
    await updateExactlyOne(this.pool, `UPDATE reward_wallet_funding_jobs
       SET status = 'CONFIRMED', block_number = ?, gas_used = ?,
           effective_gas_price_wei = ?, fee_paid_wei = ?, balance_after_wei = ?,
           receipt_json = ?, confirmed_at = CURRENT_TIMESTAMP(6),
           error_code = NULL, error_message = NULL WHERE job_id = ?`, [
      receipt.blockNumber, receipt.gasUsed.toString(), receipt.gasPrice.toString(),
      fee.toString(), balanceAfterWei.toString(), JSON.stringify(safeReceipt(receipt)), jobId,
    ]);
  }

  public async markFailed(
    jobId: string,
    code: string,
    message: string,
    receipt?: FundingReceipt,
  ): Promise<void> {
    const fee = receipt ? receipt.gasUsed * receipt.gasPrice : null;
    await updateExactlyOne(this.pool, `UPDATE reward_wallet_funding_jobs
       SET status = 'FAILED', error_code = ?, error_message = ?, receipt_json = ?,
           block_number = ?, gas_used = ?, effective_gas_price_wei = ?,
           fee_paid_wei = ?, confirmed_at = CURRENT_TIMESTAMP(6) WHERE job_id = ?`, [
      code, message, receipt ? JSON.stringify(safeReceipt(receipt)) : null,
      receipt?.blockNumber ?? null, receipt?.gasUsed.toString() ?? null,
      receipt?.gasPrice.toString() ?? null, fee?.toString() ?? null, jobId,
    ]);
  }

  public async markPendingReview(
    jobId: string,
    code: string,
    message: string,
    receipt?: FundingReceipt,
    balanceAfterWei?: bigint,
  ): Promise<void> {
    const fee = receipt ? receipt.gasUsed * receipt.gasPrice : null;
    await updateExactlyOne(this.pool, `UPDATE reward_wallet_funding_jobs
       SET status = 'PENDING_REVIEW', error_code = ?, error_message = ?,
           receipt_json = COALESCE(?, receipt_json),
           block_number = COALESCE(?, block_number),
           gas_used = COALESCE(?, gas_used),
           effective_gas_price_wei = COALESCE(?, effective_gas_price_wei),
           fee_paid_wei = COALESCE(?, fee_paid_wei),
           balance_after_wei = COALESCE(?, balance_after_wei)
       WHERE job_id = ?`, [
      code, message, receipt ? JSON.stringify(safeReceipt(receipt)) : null,
      receipt?.blockNumber ?? null, receipt?.gasUsed.toString() ?? null,
      receipt?.gasPrice.toString() ?? null, fee?.toString() ?? null,
      balanceAfterWei?.toString() ?? null, jobId,
    ]);
  }
}

function selectColumns(): string {
  return `SELECT job_id, wallet_id, wallet_address, balance_before_wei,
                 funding_amount_wei, signed_tx_hash, broadcast_tx_hash,
                 block_number, fee_paid_wei, status
            FROM reward_wallet_funding_jobs`;
}

function mapRow(row: FundingJobRow): FundingJobRecord {
  return {
    balanceBeforeWei: BigInt(row.balance_before_wei),
    ...(row.block_number === null ? {} : { blockNumber: Number(row.block_number) }),
    ...(row.broadcast_tx_hash ? { broadcastTxHash: row.broadcast_tx_hash } : {}),
    ...(row.fee_paid_wei ? { feePaidWei: BigInt(row.fee_paid_wei) } : {}),
    fundingAmountWei: BigInt(row.funding_amount_wei),
    id: String(row.wallet_id),
    jobId: row.job_id,
    ...(row.signed_tx_hash ? { signedTxHash: row.signed_tx_hash } : {}),
    status: row.status,
    walletAddress: getAddress(row.wallet_address),
  };
}

function safeReceipt(receipt: FundingReceipt): Record<string, string | number | null> {
  return {
    blockNumber: receipt.blockNumber,
    gasPriceWei: receipt.gasPrice.toString(),
    gasUsed: receipt.gasUsed.toString(),
    hash: receipt.hash,
    status: receipt.status,
  };
}

async function updateExactlyOne(
  pool: Pool,
  sql: string,
  values: (string | number | null)[],
): Promise<void> {
  const [result] = await pool.execute<ResultSetHeader>(sql, values);
  if (result.affectedRows !== 1) throw new Error("Funding job update did not affect exactly one row");
}

function isDuplicateEntryError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ER_DUP_ENTRY";
}

export { ACTIVE_STATUSES };
