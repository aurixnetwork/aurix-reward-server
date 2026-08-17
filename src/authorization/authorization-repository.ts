import { getAddress } from "ethers";
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import type {
  AuthorizationJobRecord,
  AuthorizationJobStatus,
  PlannedAuthorizationInput,
} from "./authorization-types.js";

interface AuthorizationRow extends RowDataPacket {
  readonly amount_wei: string;
  readonly approver_address: string;
  readonly approver_signature: string | null;
  readonly campaign_id: string;
  readonly claimant_address: string;
  readonly deadline: number | string;
  readonly expired_at: Date | null;
  readonly job_id: string;
  readonly reward_id: string;
  readonly reward_nonce: string;
  readonly status: AuthorizationJobStatus;
  readonly typed_data_hash: string | null;
  readonly valid_after: number | string;
  readonly wallet_id: number | string;
}

export interface AuthorizationRepository {
  findByJobId(jobId: string): Promise<AuthorizationJobRecord | undefined>;
  reservePlanned(
    input: PlannedAuthorizationInput,
    nowSeconds: bigint,
    validateExpired: ExpiredAuthorizationValidator,
  ): Promise<AuthorizationReservationResult>;
  markFailed(jobId: string, code: string, message: string): Promise<void>;
  markReady(jobId: string, typedDataHash: string, signature: string): Promise<void>;
}

export type ExpiredAuthorizationValidator = (
  authorization: AuthorizationJobRecord,
) => Promise<void>;

export interface AuthorizationReservationResult {
  readonly expiredAuthorizationJobId?: string;
}

export class DuplicateAuthorizationError extends Error {
  public constructor() {
    super("Authorization job conflicts with an existing job, rewardId, or contract nonce");
    this.name = "DuplicateAuthorizationError";
  }
}

export class ActiveAuthorizationExistsError extends Error {
  public constructor(public readonly authorizationJobId: string) {
    super("An active authorization already exists for this contract reward nonce");
    this.name = "ActiveAuthorizationExistsError";
  }
}

export class AuthorizationReissueRequiresClaimReconciliationError extends Error {
  public constructor(public readonly authorizationJobId: string) {
    super("The expired authorization has an unresolved claim job");
    this.name = "AuthorizationReissueRequiresClaimReconciliationError";
  }
}

export class MySqlAuthorizationRepository implements AuthorizationRepository {
  public constructor(private readonly pool: Pool) {}

  public async listActiveByCampaignClaimant(
    campaignId: string,
    claimant: string,
  ): Promise<readonly AuthorizationJobRecord[]> {
    const [rows] = await this.pool.execute<AuthorizationRow[]>(
      `${selectColumns()}
        WHERE campaign_id = ? AND claimant_address = ?
          AND status IN ('PLANNED','SIGNED','READY')
        ORDER BY id DESC`,
      [campaignId, getAddress(claimant)],
    );
    return rows.map(mapRow);
  }

  public async findByJobId(
    jobId: string,
  ): Promise<AuthorizationJobRecord | undefined> {
    const [rows] = await this.pool.execute<AuthorizationRow[]>(
      `${selectColumns()} WHERE job_id = ?`,
      [jobId],
    );
    const row = rows[0];
    return row ? mapRow(row) : undefined;
  }

  public async reservePlanned(
    input: PlannedAuthorizationInput,
    nowSeconds: bigint,
    validateExpired: ExpiredAuthorizationValidator,
  ): Promise<AuthorizationReservationResult> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<AuthorizationRow[]>(
        `${selectColumns()}
          WHERE campaign_id = ? AND claimant_address = ? AND reward_nonce = ?
            AND active_nonce_guard = 1
          LIMIT 1 FOR UPDATE`,
        [
          input.campaignId,
          getAddress(input.claimant),
          input.rewardNonce.toString(),
        ],
      );
      const active = rows[0] ? mapRow(rows[0]) : undefined;
      if (active && nowSeconds <= active.deadline) {
        throw new ActiveAuthorizationExistsError(active.jobId);
      }

      if (active) {
        const [claimRows] = await connection.execute<RowDataPacket[]>(
          `SELECT job_id
             FROM reward_claim_jobs
            WHERE authorization_job_id = ?
              AND status IN ('SIGNED','BROADCAST','PENDING_REVIEW')
            LIMIT 1 FOR UPDATE`,
          [active.jobId],
        );
        if (claimRows.length > 0) {
          throw new AuthorizationReissueRequiresClaimReconciliationError(active.jobId);
        }
        await validateExpired(active);
        await updateExactlyOne(
          connection,
          `UPDATE reward_authorization_jobs
              SET status = 'EXPIRED', expired_at = CURRENT_TIMESTAMP(6)
            WHERE job_id = ? AND status IN ('PLANNED','SIGNED','READY')
              AND deadline < ?`,
          [active.jobId, nowSeconds.toString()],
        );
      }

      await insertPlanned(connection, input);
      await connection.commit();
      return active ? { expiredAuthorizationJobId: active.jobId } : {};
    } catch (error: unknown) {
      await connection.rollback();
      if (isDuplicateEntryError(error)) throw new DuplicateAuthorizationError();
      throw error;
    } finally {
      connection.release();
    }
  }

  public async markReady(
    jobId: string,
    typedDataHash: string,
    signature: string,
  ): Promise<void> {
    await updateExactlyOne(
      this.pool,
      `UPDATE reward_authorization_jobs
          SET typed_data_hash = ?, approver_signature = ?, status = 'READY',
              signed_at = CURRENT_TIMESTAMP(6), error_code = NULL,
              error_message = NULL
        WHERE job_id = ? AND status = 'PLANNED'`,
      [typedDataHash, signature, jobId],
    );
  }

  public async markFailed(jobId: string, code: string, message: string): Promise<void> {
    await updateExactlyOne(
      this.pool,
      `UPDATE reward_authorization_jobs
          SET status = 'FAILED', error_code = ?, error_message = ?
        WHERE job_id = ? AND status IN ('PLANNED','SIGNED')`,
      [code, message, jobId],
    );
  }
}

function selectColumns(): string {
  return `SELECT job_id, wallet_id, claimant_address, campaign_id, reward_id,
                 reward_nonce, amount_wei, valid_after, deadline,
                 approver_address, typed_data_hash, approver_signature, status,
                 expired_at
            FROM reward_authorization_jobs`;
}

function mapRow(row: AuthorizationRow): AuthorizationJobRecord {
  return {
    amount: BigInt(row.amount_wei),
    approverAddress: getAddress(row.approver_address),
    ...(row.approver_signature ? { approverSignature: row.approver_signature } : {}),
    campaignId: row.campaign_id,
    claimant: getAddress(row.claimant_address),
    deadline: BigInt(row.deadline),
    ...(row.expired_at ? { expiredAt: row.expired_at } : {}),
    jobId: row.job_id,
    rewardId: row.reward_id,
    rewardNonce: BigInt(row.reward_nonce),
    status: row.status,
    ...(row.typed_data_hash ? { typedDataHash: row.typed_data_hash } : {}),
    validAfter: BigInt(row.valid_after),
    walletId: String(row.wallet_id),
  };
}

async function updateExactlyOne(
  executor: Pick<Pool | PoolConnection, "execute">,
  sql: string,
  values: string[],
): Promise<void> {
  const [result] = await executor.execute<ResultSetHeader>(sql, values);
  if (result.affectedRows !== 1) {
    throw new Error("Authorization job update did not affect exactly one row");
  }
}

async function insertPlanned(
  executor: Pick<Pool | PoolConnection, "execute">,
  input: PlannedAuthorizationInput,
): Promise<void> {
  await executor.execute(
    `INSERT INTO reward_authorization_jobs
      (job_id, wallet_id, claimant_address, campaign_id, reward_id,
       reward_nonce, amount_wei, valid_after, deadline,
       approver_address, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PLANNED')`,
    [
      input.jobId,
      input.walletId,
      getAddress(input.claimant),
      input.campaignId,
      input.rewardId,
      input.rewardNonce.toString(),
      input.amount.toString(),
      input.validAfter.toString(),
      input.deadline.toString(),
      getAddress(input.approverAddress),
    ],
  );
}

function isDuplicateEntryError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ER_DUP_ENTRY";
}
