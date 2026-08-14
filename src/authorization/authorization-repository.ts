import { getAddress } from "ethers";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

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
  insertPlanned(input: PlannedAuthorizationInput): Promise<void>;
  markFailed(jobId: string, code: string, message: string): Promise<void>;
  markReady(jobId: string, typedDataHash: string, signature: string): Promise<void>;
}

export class DuplicateAuthorizationError extends Error {
  public constructor() {
    super("Authorization job conflicts with an existing job, rewardId, or contract nonce");
    this.name = "DuplicateAuthorizationError";
  }
}

export class MySqlAuthorizationRepository implements AuthorizationRepository {
  public constructor(private readonly pool: Pool) {}

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

  public async insertPlanned(input: PlannedAuthorizationInput): Promise<void> {
    try {
      await this.pool.execute(
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
    } catch (error: unknown) {
      if (isDuplicateEntryError(error)) throw new DuplicateAuthorizationError();
      throw error;
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
                 approver_address, typed_data_hash, approver_signature, status
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
  pool: Pool,
  sql: string,
  values: string[],
): Promise<void> {
  const [result] = await pool.execute<ResultSetHeader>(sql, values);
  if (result.affectedRows !== 1) {
    throw new Error("Authorization job update did not affect exactly one row");
  }
}

function isDuplicateEntryError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ER_DUP_ENTRY";
}
