import { getAddress } from "ethers";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

import type {
  CampaignEvidenceRecord,
  CampaignEvidenceRepository,
  CampaignOperationStatus,
  CampaignOperationType,
  CampaignReceipt,
  SignedCampaignEvidenceInput,
} from "./campaign-execution-types.js";

interface CampaignEvidenceRow extends RowDataPacket {
  readonly amount_wei: string;
  readonly block_number: number | string | null;
  readonly broadcast_tx_hash: string | null;
  readonly expected_sender: string;
  readonly fee_paid_wei: string | null;
  readonly operation_id: string;
  readonly operation_type: CampaignOperationType;
  readonly payload_json: string | Record<string, unknown>;
  readonly signed_tx_hash: string;
  readonly status: CampaignOperationStatus;
}

export class MySqlCampaignEvidenceRepository implements CampaignEvidenceRepository {
  public constructor(private readonly pool: Pool) {}

  public async insertSigned(input: SignedCampaignEvidenceInput): Promise<void> {
    await this.pool.execute(
      `INSERT INTO campaign_execution_operations
        (operation_id, operation_type, expected_sender, amount_wei, tx_nonce,
         gas_limit, gas_price_wei, calldata_hash, signed_tx_hash, payload_json, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SIGNED')`,
      [
        input.operationId,
        input.operationType,
        getAddress(input.expectedSender),
        input.amountWei.toString(),
        input.txNonce,
        input.gasLimit.toString(),
        input.gasPriceWei.toString(),
        input.calldataHash,
        input.signedTxHash,
        JSON.stringify(input.payload),
      ],
    );
  }

  public async listAll(): Promise<readonly CampaignEvidenceRecord[]> {
    const [rows] = await this.pool.execute<CampaignEvidenceRow[]>(
      `${selectColumns()} ORDER BY id`,
    );
    return rows.map(mapRow);
  }

  public async listUnresolved(): Promise<readonly CampaignEvidenceRecord[]> {
    const [rows] = await this.pool.execute<CampaignEvidenceRow[]>(
      `${selectColumns()} WHERE status IN ('SIGNED','BROADCAST','PENDING_REVIEW') ORDER BY id`,
    );
    return rows.map(mapRow);
  }

  public async markBroadcast(operationId: string, txHash: string): Promise<void> {
    await updateExactlyOne(this.pool, `UPDATE campaign_execution_operations
      SET status = 'BROADCAST', broadcast_tx_hash = ?, broadcast_at = CURRENT_TIMESTAMP(6),
          error_code = NULL WHERE operation_id = ?`, [txHash, operationId]);
  }

  public async markConfirmed(operationId: string, receipt: CampaignReceipt): Promise<void> {
    await updateReceipt(this.pool, operationId, "CONFIRMED", null, receipt);
  }

  public async markFailed(
    operationId: string,
    code: string,
    receipt: CampaignReceipt,
  ): Promise<void> {
    await updateReceipt(this.pool, operationId, "FAILED", code, receipt);
  }

  public async markPendingReview(operationId: string, code: string): Promise<void> {
    await updateExactlyOne(this.pool, `UPDATE campaign_execution_operations
      SET status = 'PENDING_REVIEW', error_code = ? WHERE operation_id = ?`,
    [code, operationId]);
  }
}

function selectColumns(): string {
  return `SELECT operation_id, operation_type, expected_sender, amount_wei,
                 signed_tx_hash, broadcast_tx_hash, payload_json, block_number,
                 fee_paid_wei, status
            FROM campaign_execution_operations`;
}

function mapRow(row: CampaignEvidenceRow): CampaignEvidenceRecord {
  const payload = typeof row.payload_json === "string"
    ? JSON.parse(row.payload_json) as Record<string, unknown>
    : row.payload_json;
  return {
    amountWei: BigInt(row.amount_wei),
    ...(row.block_number === null ? {} : { blockNumber: Number(row.block_number) }),
    ...(row.broadcast_tx_hash ? { broadcastTxHash: row.broadcast_tx_hash } : {}),
    expectedSender: getAddress(row.expected_sender),
    ...(row.fee_paid_wei ? { feePaidWei: BigInt(row.fee_paid_wei) } : {}),
    operationId: row.operation_id,
    operationType: row.operation_type,
    payload,
    signedTxHash: row.signed_tx_hash,
    status: row.status,
  };
}

async function updateReceipt(
  pool: Pool,
  operationId: string,
  status: "CONFIRMED" | "FAILED",
  errorCode: string | null,
  receipt: CampaignReceipt,
): Promise<void> {
  const feePaidWei = receipt.gasUsed * receipt.gasPrice;
  await updateExactlyOne(pool, `UPDATE campaign_execution_operations
    SET status = ?, error_code = ?, block_number = ?, gas_used = ?,
        effective_gas_price_wei = ?, fee_paid_wei = ?, receipt_json = ?,
        confirmed_at = CURRENT_TIMESTAMP(6) WHERE operation_id = ?`, [
    status,
    errorCode,
    receipt.blockNumber,
    receipt.gasUsed.toString(),
    receipt.gasPrice.toString(),
    feePaidWei.toString(),
    JSON.stringify(safeReceipt(receipt)),
    operationId,
  ]);
}

function safeReceipt(receipt: CampaignReceipt): object {
  return {
    blockNumber: receipt.blockNumber,
    gasPriceWei: receipt.gasPrice.toString(),
    gasUsed: receipt.gasUsed.toString(),
    hash: receipt.hash,
    logs: receipt.logs,
    status: receipt.status,
  };
}

async function updateExactlyOne(
  pool: Pool,
  sql: string,
  values: (string | number | null)[],
): Promise<void> {
  const [result] = await pool.execute<ResultSetHeader>(sql, values);
  if (result.affectedRows !== 1) {
    throw new Error("Campaign evidence update did not affect exactly one row");
  }
}
