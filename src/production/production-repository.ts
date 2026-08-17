import { randomUUID } from "node:crypto";

import { getAddress } from "ethers";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

import type { DispatcherRepository } from "./global-dispatcher.js";
import type { CampaignPolicy, Lease, RewardRun, RewardRunItem, RewardRunStatus, WalletExecutionResult } from "./production-types.js";

interface ItemRow extends RowDataPacket {
  readonly id: number | string;
  readonly run_id: string;
  readonly sequence: number;
  readonly chain_id: number;
  readonly wallet_id: number | string;
  readonly claimant_address: string;
  readonly campaign_id: string;
  readonly campaign_name: string;
  readonly policy: CampaignPolicy;
  readonly policy_scope: string;
  readonly reward_amount_wei: string;
  readonly authorization_job_id: string | null;
  readonly claim_job_id: string | null;
  readonly classification: RewardRunItem["classification"];
  readonly lifecycle_state: RewardRunItem["lifecycleState"];
  readonly transaction_hash: string | null;
  readonly reward_nonce: string | null;
}

interface LeaseRow extends RowDataPacket {
  readonly owner_id: string;
  readonly lease_token: string;
  readonly expires_at: Date;
}

interface CountRow extends RowDataPacket {
  readonly processed_count: number;
  readonly target_wallet_count: number;
  readonly total_gas_wei: string;
  readonly total_reward_wei: string;
}
interface RunRow extends RowDataPacket {
  readonly run_id: string; readonly campaign_id: string; readonly campaign_name: string;
  readonly campaign_policy: CampaignPolicy; readonly reward_amount_wei: string;
  readonly dispatch_interval_seconds: number; readonly target_wallet_count: number;
  readonly processed_count: number; readonly confirmed_count: number; readonly already_rewarded_count: number;
  readonly skipped_count: number; readonly blocked_count: number; readonly reconciliation_required_count: number;
  readonly failed_count: number; readonly transactions_sent: number; readonly total_reward_wei: string;
  readonly total_gas_wei: string; readonly current_sequence: number; readonly status: RewardRunStatus;
  readonly created_at: Date; readonly started_at: Date | null; readonly paused_at: Date | null;
  readonly resumed_at: Date | null; readonly completed_at: Date | null;
}

export class MySqlProductionRepository implements DispatcherRepository {
  public constructor(private readonly pool: Pool) {}

  public acquireDispatcherLease(ownerId: string, now: Date, leaseSeconds: number): Promise<Lease | undefined> {
    return this.acquireLease("reward_dispatcher_leases", ["dispatcher_key"], ["MAINNET_REWARD_DISPATCHER"], ownerId, now, leaseSeconds);
  }

  public async releaseDispatcherLease(lease: Lease): Promise<void> {
    await this.pool.execute(
      "DELETE FROM reward_dispatcher_leases WHERE dispatcher_key = ? AND owner_id = ? AND lease_token = ?",
      ["MAINNET_REWARD_DISPATCHER", lease.ownerId, lease.token],
    );
  }

  public acquireWalletLease(item: RewardRunItem, ownerId: string, now: Date, leaseSeconds: number): Promise<Lease | undefined> {
    return this.acquireLease(
      "wallet_execution_leases", ["chain_id", "wallet_address"],
      [item.chainId, getAddress(item.claimant)], ownerId, now, leaseSeconds,
    );
  }

  public async releaseWalletLease(item: RewardRunItem, lease: Lease): Promise<void> {
    await this.pool.execute(
      "DELETE FROM wallet_execution_leases WHERE chain_id = ? AND wallet_address = ? AND owner_id = ? AND lease_token = ?",
      [item.chainId, getAddress(item.claimant), lease.ownerId, lease.token],
    );
  }

  public async findRecoveryItem(now: Date): Promise<RewardRunItem | undefined> {
    const [rows] = await this.pool.execute<ItemRow[]>(
      `SELECT i.*, c.campaign_name
         FROM reward_run_items i
         JOIN reward_runs r ON r.run_id = i.run_id
         JOIN reward_campaign_operations c ON c.id = r.campaign_operation_id
        WHERE r.status = 'RUNNING'
          AND (i.lifecycle_state IN ('ACQUIRED','AUTHORIZED','SIGNED','BROADCAST','PENDING_REVIEW')
               OR i.classification = 'RECONCILIATION_REQUIRED')
          AND (i.started_at IS NULL OR i.started_at <= ?)
        ORDER BY i.started_at, i.id
        LIMIT 1`,
      [now],
    );
    return rows[0] ? mapItem(rows[0]) : undefined;
  }

  public async findOldestDueItem(now: Date): Promise<RewardRunItem | undefined> {
    const [rows] = await this.pool.execute<ItemRow[]>(
      `SELECT i.*, c.campaign_name
         FROM reward_campaign_operations c
         JOIN reward_runs r ON r.campaign_operation_id = c.id
         JOIN reward_run_items i ON i.run_id = r.run_id
        WHERE c.operational_status = 'ACTIVE'
          AND r.status = 'RUNNING'
          AND i.classification IN ('PENDING','READY','SKIPPED')
          AND i.lifecycle_state = 'PENDING'
          AND (c.next_dispatch_at IS NULL OR c.next_dispatch_at <= ?)
        ORDER BY COALESCE(c.next_dispatch_at, c.created_at), c.id, i.sequence
        LIMIT 1`,
      [now],
    );
    return rows[0] ? mapItem(rows[0]) : undefined;
  }

  public async findRun(runId: string): Promise<RewardRun | undefined> {
    const [rows] = await this.pool.execute<RunRow[]>(
      `SELECT r.*, c.campaign_name FROM reward_runs r
        JOIN reward_campaign_operations c ON c.id = r.campaign_operation_id
       WHERE r.run_id = ?`, [runId],
    );
    const row = rows[0];
    if (!row) return undefined;
    return {
      runId: row.run_id, campaignId: row.campaign_id, campaignName: row.campaign_name,
      campaignPolicy: row.campaign_policy, rewardAmount: BigInt(row.reward_amount_wei),
      dispatchIntervalSeconds: row.dispatch_interval_seconds, targetWalletCount: row.target_wallet_count,
      processedCount: row.processed_count, confirmedCount: row.confirmed_count,
      alreadyRewardedCount: row.already_rewarded_count, skippedCount: row.skipped_count,
      blockedCount: row.blocked_count, reconciliationRequiredCount: row.reconciliation_required_count,
      failedCount: row.failed_count, transactionsSent: row.transactions_sent,
      totalReward: BigInt(row.total_reward_wei), totalGas: BigInt(row.total_gas_wei),
      currentSequence: row.current_sequence, status: row.status, createdAt: new Date(row.created_at),
      ...(row.started_at ? { startedAt: new Date(row.started_at) } : {}),
      ...(row.paused_at ? { pausedAt: new Date(row.paused_at) } : {}),
      ...(row.resumed_at ? { resumedAt: new Date(row.resumed_at) } : {}),
      ...(row.completed_at ? { completedAt: new Date(row.completed_at) } : {}),
    };
  }

  public async markItemAcquired(item: RewardRunItem, now: Date): Promise<boolean> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE reward_run_items SET lifecycle_state = 'ACQUIRED', started_at = COALESCE(started_at, ?)
        WHERE id = ? AND lifecycle_state = 'PENDING' AND classification IN ('PENDING','READY','SKIPPED')`,
      [now, item.id],
    );
    return result.affectedRows === 1;
  }

  public async finalizeItem(
    item: RewardRunItem, result: WalletExecutionResult, completedAt: Date,
  ): Promise<{ readonly processed: number; readonly target: number }> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [updated] = await connection.execute<ResultSetHeader>(
        `UPDATE reward_run_items
            SET action = ?, classification = ?, lifecycle_state = 'FINALIZED',
                authorization_job_id = COALESCE(?, authorization_job_id),
                claim_job_id = COALESCE(?, claim_job_id), transaction_hash = COALESCE(?, transaction_hash),
                block_number = COALESCE(?, block_number), reward_nonce = COALESCE(?, reward_nonce),
                actual_gas_wei = COALESCE(?, actual_gas_wei), blocker_code = ?, error_code = ?, completed_at = ?
          WHERE id = ? AND lifecycle_state <> 'FINALIZED'`,
        [result.action, result.classification, result.authorizationJobId ?? null,
          result.claimJobId ?? null, result.transactionHash ?? null, result.blockNumber ?? null,
          result.rewardNonce?.toString() ?? null, result.actualGasWei?.toString() ?? null,
          result.blockerCode ?? null, result.errorCode ?? null, completedAt, item.id],
      );
      if (updated.affectedRows !== 1) throw new Error("RUN_ITEM_ALREADY_FINALIZED");
      const confirmed = result.classification === "CONFIRMED" ? 1 : 0;
      const already = result.action === "SKIP_ALREADY_REWARDED" ? 1 : 0;
      const skipped = result.classification === "SKIPPED" && already === 0 ? 1 : 0;
      const blocked = result.classification === "BLOCKED" ? 1 : 0;
      const reconcile = result.classification === "RECONCILIATION_REQUIRED" ? 1 : 0;
      const failed = ["FAILED", "SYSTEM_ERROR"].includes(result.classification) ? 1 : 0;
      const [lockedRows] = await connection.execute<CountRow[]>(
        "SELECT processed_count, target_wallet_count, total_reward_wei, total_gas_wei FROM reward_runs WHERE run_id = ? FOR UPDATE",
        [item.runId],
      );
      const locked = lockedRows[0];
      if (!locked) throw new Error("REWARD_RUN_NOT_FOUND");
      const totalReward = BigInt(locked.total_reward_wei) + (confirmed ? item.rewardAmount : 0n);
      const totalGas = BigInt(locked.total_gas_wei) + (result.actualGasWei ?? 0n);
      await connection.execute(
        `UPDATE reward_runs
            SET processed_count = processed_count + 1, confirmed_count = confirmed_count + ?,
                already_rewarded_count = already_rewarded_count + ?, skipped_count = skipped_count + ?,
                blocked_count = blocked_count + ?, reconciliation_required_count = reconciliation_required_count + ?,
                failed_count = failed_count + ?, transactions_sent = transactions_sent + ?,
                total_reward_wei = ?, total_gas_wei = ?,
                current_sequence = GREATEST(current_sequence, ?)
          WHERE run_id = ?`,
        [confirmed, already, skipped, blocked, reconcile, failed, result.transactionsSent,
          totalReward.toString(), totalGas.toString(),
          item.sequence, item.runId],
      );
      await connection.execute(
        `UPDATE reward_campaign_operations c JOIN reward_runs r ON r.campaign_operation_id = c.id
            SET c.last_dispatched_at = ?, c.next_dispatch_at = DATE_ADD(?, INTERVAL r.dispatch_interval_seconds SECOND)
          WHERE r.run_id = ?`,
        [completedAt, completedAt, item.runId],
      );
      const [rows] = await connection.execute<CountRow[]>(
        "SELECT processed_count, target_wallet_count, total_reward_wei, total_gas_wei FROM reward_runs WHERE run_id = ? FOR UPDATE",
        [item.runId],
      );
      const row = rows[0];
      if (!row) throw new Error("REWARD_RUN_NOT_FOUND");
      if (row.processed_count >= row.target_wallet_count) {
        await connection.execute(
          `UPDATE reward_runs SET status = CASE
             WHEN blocked_count + reconciliation_required_count + failed_count > 0 THEN 'COMPLETED_WITH_EXCEPTIONS'
             ELSE 'COMPLETED' END, completed_at = ? WHERE run_id = ?`,
          [completedAt, item.runId],
        );
      }
      await connection.commit();
      return { processed: row.processed_count, target: row.target_wallet_count };
    } catch (error: unknown) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  public async hasConfirmedFirstReward(chainId: number, policyScope: string, claimant: string): Promise<boolean> {
    return this.exists(
      "SELECT 1 FROM reward_run_items WHERE chain_id = ? AND policy = 'FIRST_REWARD_ONLY' AND policy_scope = ? AND claimant_address = ? AND classification = 'CONFIRMED' LIMIT 1",
      [chainId, policyScope, getAddress(claimant)],
    );
  }

  public async hasConfirmedCampaignReward(chainId: number, campaignId: string, claimant: string): Promise<boolean> {
    return this.exists(
      "SELECT 1 FROM reward_run_items WHERE chain_id = ? AND campaign_id = ? AND claimant_address = ? AND classification = 'CONFIRMED' LIMIT 1",
      [chainId, campaignId, getAddress(claimant)],
    );
  }

  public async hasUnresolvedReward(
    chainId: number, policy: CampaignPolicy, policyScope: string, campaignId: string, claimant: string,
  ): Promise<boolean> {
    const scopeSql = policy === "FIRST_REWARD_ONLY" ? "policy_scope = ?" : "campaign_id = ?";
    return this.exists(
      `SELECT 1 FROM reward_run_items WHERE chain_id = ? AND ${scopeSql} AND claimant_address = ?
        AND (classification = 'RECONCILIATION_REQUIRED' OR lifecycle_state IN ('AUTHORIZED','SIGNED','BROADCAST','PENDING_REVIEW')) LIMIT 1`,
      [chainId, policy === "FIRST_REWARD_ONLY" ? policyScope : campaignId, getAddress(claimant)],
    );
  }

  public async pauseRun(runId: string, at: Date = new Date()): Promise<boolean> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      "UPDATE reward_runs SET status = 'PAUSED', paused_at = ? WHERE run_id = ? AND status = 'RUNNING'", [at, runId],
    );
    return result.affectedRows === 1;
  }

  public async resumeRun(runId: string, at: Date = new Date()): Promise<boolean> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      "UPDATE reward_runs SET status = 'RUNNING', resumed_at = ? WHERE run_id = ? AND status = 'PAUSED'", [at, runId],
    );
    return result.affectedRows === 1;
  }

  private async exists(sql: string, parameters: readonly (string | number | Date | null)[]): Promise<boolean> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(sql, [...parameters]);
    return rows.length > 0;
  }

  private async acquireLease(
    table: "reward_dispatcher_leases" | "wallet_execution_leases",
    keyColumns: readonly string[], keyValues: readonly (string | number)[], ownerId: string, now: Date, leaseSeconds: number,
  ): Promise<Lease | undefined> {
    const token = randomUUID();
    const expiresAt = new Date(now.getTime() + leaseSeconds * 1_000);
    const columns = [...keyColumns, "owner_id", "lease_token", "acquired_at", "expires_at"];
    const placeholders = columns.map(() => "?").join(", ");
    await this.pool.execute(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})
       ON DUPLICATE KEY UPDATE
         owner_id = IF(expires_at <= VALUES(acquired_at), VALUES(owner_id), owner_id),
         lease_token = IF(expires_at <= VALUES(acquired_at), VALUES(lease_token), lease_token),
         acquired_at = IF(expires_at <= VALUES(acquired_at), VALUES(acquired_at), acquired_at),
         expires_at = IF(expires_at <= VALUES(acquired_at), VALUES(expires_at), expires_at)`,
      [...keyValues, ownerId, token, now, expiresAt],
    );
    const where = keyColumns.map((column) => `${column} = ?`).join(" AND ");
    const [rows] = await this.pool.execute<LeaseRow[]>(
      `SELECT owner_id, lease_token, expires_at FROM ${table} WHERE ${where}`,
      [...keyValues],
    );
    const row = rows[0];
    return row?.lease_token === token ? { expiresAt: new Date(row.expires_at), ownerId, token } : undefined;
  }
}

function mapItem(row: ItemRow): RewardRunItem {
  return {
    id: String(row.id),
    runId: row.run_id,
    sequence: row.sequence,
    chainId: row.chain_id,
    walletId: String(row.wallet_id),
    claimant: getAddress(row.claimant_address),
    campaignId: row.campaign_id,
    campaignName: row.campaign_name,
    policy: row.policy,
    policyScope: row.policy_scope,
    rewardAmount: BigInt(row.reward_amount_wei),
    ...(row.authorization_job_id ? { authorizationJobId: row.authorization_job_id } : {}),
    ...(row.claim_job_id ? { claimJobId: row.claim_job_id } : {}),
    classification: row.classification,
    lifecycleState: row.lifecycle_state,
    ...(row.transaction_hash ? { transactionHash: row.transaction_hash } : {}),
    ...(row.reward_nonce === null ? {} : { rewardNonce: BigInt(row.reward_nonce) }),
  };
}
