import { getAddress } from "ethers";
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import type {
  ClaimJobRecord,
  ClaimJobStatus,
  ClaimPostState,
  ClaimReceipt,
  RewardClaimedEvent,
  SignedClaimJobInput,
} from "./claim-types.js";
import {
  ClaimPersistenceError,
  claimPersistenceError,
  type ClaimPersistenceStage,
  withCleanupFailure,
} from "./claim-persistence-error.js";

interface ClaimJobRow extends RowDataPacket {
  readonly amount_wei: string;
  readonly authorization_job_id: string;
  readonly block_number: number | string | null;
  readonly broadcast_tx_hash: string | null;
  readonly campaign_distributed_after: string | null;
  readonly campaign_distributed_before: string;
  readonly campaign_id: string;
  readonly claimant_address: string;
  readonly effective_gas_price_wei: string | null;
  readonly error_code: string | null;
  readonly error_message: string | null;
  readonly fee_paid_wei: string | null;
  readonly gas_limit: string;
  readonly gas_price_wei: string;
  readonly gas_used: string | null;
  readonly irb_balance_after: string | null;
  readonly irb_balance_before: string;
  readonly job_id: string;
  readonly last_claim_at_after: number | string | null;
  readonly receipt_json: unknown;
  readonly reward_claimed_event_json: unknown;
  readonly reward_claimed_event_validated: boolean | number | null;
  readonly reward_contract_balance_after: string | null;
  readonly reward_contract_balance_before: string;
  readonly reward_id: string;
  readonly reward_nonce: string;
  readonly signed_tx_hash: string;
  readonly status: ClaimJobStatus;
  readonly tx_nonce: number | string;
  readonly wallet_id: number | string;
}

export interface ConfirmedClaimInput {
  readonly event: RewardClaimedEvent;
  readonly postState: ClaimPostState;
  readonly receipt: ClaimReceipt;
}

export interface ClaimRepository {
  findByAuthorizationJobId(authorizationJobId: string): Promise<ClaimJobRecord | undefined>;
  findByRewardId(rewardId: string): Promise<ClaimJobRecord | undefined>;
  insertSigned(input: SignedClaimJobInput): Promise<void>;
  listUnresolved(): Promise<readonly ClaimJobRecord[]>;
  markBroadcast(jobId: string, hash: string): Promise<void>;
  markConfirmed(jobId: string, authorizationJobId: string, input: ConfirmedClaimInput): Promise<void>;
  markFailed(jobId: string, code: string, message: string, receipt?: ClaimReceipt): Promise<void>;
  markPendingReview(
    jobId: string,
    code: string,
    message: string,
    receipt?: ClaimReceipt,
  ): Promise<void>;
}

export class MySqlClaimRepository implements ClaimRepository {
  public constructor(private readonly pool: Pool) {}

  public async findUnresolvedByWalletCampaign(
    walletId: string,
    campaignId: string,
  ): Promise<ClaimJobRecord | undefined> {
    const [rows] = await this.pool.execute<ClaimJobRow[]>(
      `${selectColumns()}
        WHERE wallet_id = ? AND campaign_id = ?
          AND status IN ('SIGNED','BROADCAST','PENDING_REVIEW')
        ORDER BY id DESC LIMIT 1`,
      [walletId, campaignId],
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  }

  public async findLatestByWalletCampaign(
    walletId: string,
    campaignId: string,
  ): Promise<ClaimJobRecord | undefined> {
    const [rows] = await this.pool.execute<ClaimJobRow[]>(
      `${selectColumns()} WHERE wallet_id = ? AND campaign_id = ? ORDER BY id DESC LIMIT 1`,
      [walletId, campaignId],
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  }

  public async findByAuthorizationJobId(
    authorizationJobId: string,
  ): Promise<ClaimJobRecord | undefined> {
    const [rows] = await this.pool.execute<ClaimJobRow[]>(
      `${selectColumns()} WHERE authorization_job_id = ?`,
      [authorizationJobId],
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  }

  public async findByRewardId(rewardId: string): Promise<ClaimJobRecord | undefined> {
    const [rows] = await this.pool.execute<ClaimJobRow[]>(
      `${selectColumns()} WHERE reward_id = ?`,
      [rewardId],
    );
    return rows[0] ? mapRow(rows[0]) : undefined;
  }

  public async insertSigned(input: SignedClaimJobInput): Promise<void> {
    let connection: PoolConnection;
    try {
      connection = await this.pool.getConnection();
    } catch (error: unknown) {
      throw claimPersistenceError("GET_CONNECTION", error);
    }

    let stage: ClaimPersistenceStage = "BEGIN_TRANSACTION";
    let primaryError: ClaimPersistenceError | undefined;
    try {
      await connection.beginTransaction();
      stage = "LOCK_AUTHORIZATION";
      const [authorizationRows] = await connection.execute<RowDataPacket[]>(
        `SELECT status
           FROM reward_authorization_jobs
          WHERE job_id = ?
          LIMIT 1 FOR UPDATE`,
        [input.authorizationJobId],
      );
      if (authorizationRows[0]?.status !== "READY") {
        throw new ClaimPersistenceError("AUTHORIZATION_NOT_READY");
      }
      stage = "INSERT_SIGNED_JOB";
      await connection.execute(
        `INSERT INTO reward_claim_jobs
          (job_id, authorization_job_id, wallet_id, claimant_address,
           campaign_id, reward_id, reward_nonce, amount_wei, tx_nonce,
           gas_limit, gas_price_wei, signed_tx_hash, irb_balance_before,
           reward_contract_balance_before, campaign_distributed_before,
           status, signed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SIGNED',
                 CURRENT_TIMESTAMP(6))`,
        [
          input.jobId,
          input.authorizationJobId,
          input.walletId,
          getAddress(input.claimant),
          input.campaignId,
          input.rewardId,
          input.rewardNonce.toString(),
          input.amount.toString(),
          input.txNonce,
          input.gasLimit.toString(),
          input.gasPriceWei.toString(),
          input.signedTxHash,
          input.irbBalanceBefore.toString(),
          input.rewardContractBalanceBefore.toString(),
          input.campaignDistributedBefore.toString(),
        ],
      );
      stage = "COMMIT";
      await connection.commit();
    } catch (error: unknown) {
      primaryError = claimPersistenceError(stage, error);
      try {
        await connection.rollback();
      } catch (rollbackError: unknown) {
        primaryError = withCleanupFailure(primaryError, "ROLLBACK", rollbackError);
      }
    } finally {
      try {
        connection.release();
      } catch (releaseError: unknown) {
        primaryError = primaryError
          ? withCleanupFailure(primaryError, "RELEASE", releaseError)
          : claimPersistenceError("RELEASE", releaseError);
      }
    }
    if (primaryError) throw primaryError;
  }

  public async listUnresolved(): Promise<readonly ClaimJobRecord[]> {
    const [rows] = await this.pool.execute<ClaimJobRow[]>(
      `${selectColumns()}
        WHERE status IN ('SIGNED','BROADCAST','PENDING_REVIEW') ORDER BY id`,
    );
    return rows.map(mapRow);
  }

  public async markBroadcast(jobId: string, hash: string): Promise<void> {
    await updateExactlyOne(
      this.pool,
      `UPDATE reward_claim_jobs
          SET status = 'BROADCAST', broadcast_tx_hash = ?,
              broadcast_at = CURRENT_TIMESTAMP(6), error_code = NULL,
              error_message = NULL
        WHERE job_id = ? AND status IN ('SIGNED','PENDING_REVIEW')`,
      [hash, jobId],
    );
  }

  public async markConfirmed(
    jobId: string,
    authorizationJobId: string,
    input: ConfirmedClaimInput,
  ): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const fee = input.receipt.gasUsed * input.receipt.gasPrice;
      await updateExactlyOne(
        connection,
        `UPDATE reward_claim_jobs
            SET status = 'CONFIRMED', block_number = ?, gas_used = ?,
                effective_gas_price_wei = ?, fee_paid_wei = ?,
                irb_balance_after = ?, reward_contract_balance_after = ?,
                campaign_distributed_after = ?, last_claim_at_after = ?,
                reward_claimed_event_json = ?, reward_claimed_event_validated = TRUE,
                receipt_json = ?, confirmed_at = CURRENT_TIMESTAMP(6),
                error_code = NULL, error_message = NULL
          WHERE job_id = ? AND status IN ('SIGNED','BROADCAST','PENDING_REVIEW')`,
        [
          input.receipt.blockNumber,
          input.receipt.gasUsed.toString(),
          input.receipt.gasPrice.toString(),
          fee.toString(),
          input.postState.irbBalanceAfter.toString(),
          input.postState.rewardContractBalanceAfter.toString(),
          input.postState.campaignDistributedAfter.toString(),
          input.postState.lastClaimAtAfter.toString(),
          JSON.stringify(safeEvent(input.event)),
          JSON.stringify(safeReceipt(input.receipt)),
          jobId,
        ],
      );
      const [authorizationResult] = await connection.execute<ResultSetHeader>(
        `UPDATE reward_authorization_jobs
            SET status = 'CONSUMED', consumed_at = COALESCE(consumed_at, CURRENT_TIMESTAMP(6)),
                error_code = NULL, error_message = NULL
          WHERE job_id = ? AND status IN ('READY','CONSUMED')`,
        [authorizationJobId],
      );
      if (authorizationResult.affectedRows !== 1) {
        throw new Error("Authorization was not READY for confirmed claim consumption");
      }
      await connection.commit();
    } catch (error: unknown) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  public async markFailed(
    jobId: string,
    code: string,
    message: string,
    receipt?: ClaimReceipt,
  ): Promise<void> {
    await updateStatusWithEvidence(this.pool, "FAILED", jobId, code, message, receipt);
  }

  public async markPendingReview(
    jobId: string,
    code: string,
    message: string,
    receipt?: ClaimReceipt,
  ): Promise<void> {
    await updateStatusWithEvidence(
      this.pool,
      "PENDING_REVIEW",
      jobId,
      code,
      message,
      receipt,
    );
  }
}

function selectColumns(): string {
  return `SELECT job_id, authorization_job_id, wallet_id, claimant_address,
                 campaign_id, reward_id, reward_nonce, amount_wei, tx_nonce,
                 gas_limit, gas_price_wei, signed_tx_hash, broadcast_tx_hash,
                 block_number, gas_used, effective_gas_price_wei, fee_paid_wei,
                 irb_balance_before, irb_balance_after,
                 reward_contract_balance_before, reward_contract_balance_after,
                 campaign_distributed_before, campaign_distributed_after,
                 last_claim_at_after, reward_claimed_event_json,
                 reward_claimed_event_validated, receipt_json, status,
                 error_code, error_message
            FROM reward_claim_jobs`;
}

function mapRow(row: ClaimJobRow): ClaimJobRecord {
  const receipt = parseJson(row.receipt_json) as ReturnType<typeof safeReceipt> | undefined;
  const event = parseJson(row.reward_claimed_event_json) as ReturnType<typeof safeEvent> | undefined;
  return {
    amount: BigInt(row.amount_wei),
    authorizationJobId: row.authorization_job_id,
    ...(row.block_number === null ? {} : { blockNumber: Number(row.block_number) }),
    ...(row.broadcast_tx_hash ? { broadcastTxHash: row.broadcast_tx_hash } : {}),
    ...(row.campaign_distributed_after === null
      ? {}
      : { campaignDistributedAfter: BigInt(row.campaign_distributed_after) }),
    campaignDistributedBefore: BigInt(row.campaign_distributed_before),
    campaignId: row.campaign_id,
    claimant: getAddress(row.claimant_address),
    ...(row.effective_gas_price_wei === null
      ? {}
      : { effectiveGasPriceWei: BigInt(row.effective_gas_price_wei) }),
    ...(row.error_code ? { errorCode: row.error_code } : {}),
    ...(row.error_message ? { errorMessage: row.error_message } : {}),
    ...(row.fee_paid_wei === null ? {} : { feePaidWei: BigInt(row.fee_paid_wei) }),
    gasLimit: BigInt(row.gas_limit),
    gasPriceWei: BigInt(row.gas_price_wei),
    ...(row.gas_used === null ? {} : { gasUsed: BigInt(row.gas_used) }),
    ...(row.irb_balance_after === null
      ? {}
      : { irbBalanceAfter: BigInt(row.irb_balance_after) }),
    irbBalanceBefore: BigInt(row.irb_balance_before),
    jobId: row.job_id,
    ...(row.last_claim_at_after === null
      ? {}
      : { lastClaimAtAfter: BigInt(row.last_claim_at_after) }),
    ...(receipt ? { receipt: restoreReceipt(receipt) } : {}),
    ...(event ? { rewardClaimedEvent: restoreEvent(event) } : {}),
    ...(row.reward_claimed_event_validated === null
      ? {}
      : { rewardClaimedEventValidated: Boolean(row.reward_claimed_event_validated) }),
    ...(row.reward_contract_balance_after === null
      ? {}
      : { rewardContractBalanceAfter: BigInt(row.reward_contract_balance_after) }),
    rewardContractBalanceBefore: BigInt(row.reward_contract_balance_before),
    rewardId: row.reward_id,
    rewardNonce: BigInt(row.reward_nonce),
    signedTxHash: row.signed_tx_hash,
    status: row.status,
    txNonce: Number(row.tx_nonce),
    walletId: String(row.wallet_id),
  };
}

async function updateStatusWithEvidence(
  pool: Pool,
  status: "FAILED" | "PENDING_REVIEW",
  jobId: string,
  code: string,
  message: string,
  receipt?: ClaimReceipt,
): Promise<void> {
  const fee = receipt ? receipt.gasUsed * receipt.gasPrice : undefined;
  await updateExactlyOne(
    pool,
    `UPDATE reward_claim_jobs
        SET status = ?, error_code = ?, error_message = ?,
            receipt_json = COALESCE(?, receipt_json),
            block_number = COALESCE(?, block_number),
            gas_used = COALESCE(?, gas_used),
            effective_gas_price_wei = COALESCE(?, effective_gas_price_wei),
            fee_paid_wei = COALESCE(?, fee_paid_wei)
      WHERE job_id = ? AND status IN ('SIGNED','BROADCAST','PENDING_REVIEW')`,
    [
      status,
      code,
      message,
      receipt ? JSON.stringify(safeReceipt(receipt)) : null,
      receipt?.blockNumber ?? null,
      receipt?.gasUsed.toString() ?? null,
      receipt?.gasPrice.toString() ?? null,
      fee?.toString() ?? null,
      jobId,
    ],
  );
}

type SqlExecutor = Pick<Pool | PoolConnection, "execute">;

async function updateExactlyOne(
  executor: SqlExecutor,
  sql: string,
  values: readonly (string | number | null)[],
): Promise<void> {
  const [result] = await executor.execute<ResultSetHeader>(sql, [...values]);
  if (result.affectedRows !== 1) {
    throw new Error("Claim job update did not affect exactly one row");
  }
}

function safeReceipt(receipt: ClaimReceipt) {
  return {
    blockNumber: receipt.blockNumber,
    gasPriceWei: receipt.gasPrice.toString(),
    gasUsed: receipt.gasUsed.toString(),
    hash: receipt.hash,
    logs: receipt.logs.map((log) => ({
      address: log.address,
      data: log.data,
      index: log.index,
      topics: [...log.topics],
    })),
    status: receipt.status,
  };
}

function safeEvent(event: RewardClaimedEvent) {
  return {
    amount: event.amount.toString(),
    approver: event.approver,
    campaignId: event.campaignId,
    claimant: event.claimant,
    claimTimestamp: event.claimTimestamp.toString(),
    consumedRewardNonce: event.consumedRewardNonce.toString(),
    logIndex: event.logIndex,
    rewardId: event.rewardId,
  };
}

function parseJson(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return JSON.parse(value) as unknown;
  return value;
}

function restoreReceipt(receipt: ReturnType<typeof safeReceipt>): ClaimReceipt {
  return {
    blockNumber: receipt.blockNumber,
    gasPrice: BigInt(receipt.gasPriceWei),
    gasUsed: BigInt(receipt.gasUsed),
    hash: receipt.hash,
    logs: receipt.logs,
    status: receipt.status,
  };
}

function restoreEvent(event: ReturnType<typeof safeEvent>): RewardClaimedEvent {
  return {
    amount: BigInt(event.amount),
    approver: getAddress(event.approver),
    campaignId: event.campaignId,
    claimant: getAddress(event.claimant),
    claimTimestamp: BigInt(event.claimTimestamp),
    consumedRewardNonce: BigInt(event.consumedRewardNonce),
    logIndex: event.logIndex,
    rewardId: event.rewardId,
  };
}
