import { getAddress } from "ethers";
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";

import type { ProductionSafetyLimits } from "./reward-planning.js";
import { createRewardPlan } from "./reward-planning.js";
import type { CampaignPolicy } from "./production-types.js";

interface CampaignRow extends RowDataPacket {
  readonly id: number | string;
  readonly chain_id: number;
  readonly campaign_id: string;
  readonly campaign_name: string;
  readonly policy: CampaignPolicy;
  readonly policy_scope: string;
  readonly reward_amount_wei: string;
  readonly dispatch_interval_seconds: number;
  readonly operational_status: string;
}
interface WalletRow extends RowDataPacket { readonly id: number | string; readonly wallet_address: string }

export class RewardRunAdministration {
  public constructor(private readonly pool: Pool, private readonly limits: ProductionSafetyLimits) {}

  public async createRun(input: {
    readonly runId: string;
    readonly campaignOperationId: string;
    readonly walletIds: readonly string[];
  }): Promise<{ readonly runId: string; readonly status: "READY"; readonly targetWalletCount: number }> {
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(input.runId)) throw new Error("INVALID_RUN_ID");
    const distinctWalletIds = [...new Set(input.walletIds)];
    if (distinctWalletIds.length !== input.walletIds.length) throw new Error("DUPLICATE_RUN_WALLET");
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [campaignRows] = await connection.execute<CampaignRow[]>(
        "SELECT * FROM reward_campaign_operations WHERE id = ? FOR UPDATE", [input.campaignOperationId],
      );
      const campaign = campaignRows[0];
      if (!campaign || !["READY", "ACTIVE"].includes(campaign.operational_status)) throw new Error("CAMPAIGN_OPERATION_NOT_READY");
      const placeholders = distinctWalletIds.map(() => "?").join(",");
      const [wallets] = distinctWalletIds.length === 0 ? [[] as WalletRow[]] : await connection.execute<WalletRow[]>(
        `SELECT id, wallet_address FROM reward_user_wallets
          WHERE network_profile = 'MAINNET' AND status = 'ACTIVE' AND id IN (${placeholders}) ORDER BY id`,
        distinctWalletIds,
      );
      if (wallets.length !== distinctWalletIds.length) throw new Error("MAINNET_WALLET_SET_INCOMPLETE");
      createRewardPlan({ limits: this.limits, rewardAmountPerWallet: BigInt(campaign.reward_amount_wei), walletCount: wallets.length });
      await connection.execute(
        `INSERT INTO reward_runs
          (run_id, chain_id, campaign_operation_id, campaign_id, campaign_policy, policy_scope,
           reward_amount_wei, dispatch_interval_seconds, target_wallet_count, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'READY')`,
        [input.runId, campaign.chain_id, campaign.id, campaign.campaign_id, campaign.policy,
          campaign.policy_scope, campaign.reward_amount_wei, campaign.dispatch_interval_seconds, wallets.length],
      );
      let sequence = 0;
      for (const wallet of wallets) {
        sequence += 1;
        const initial = await classifyInitialItem(connection, campaign, getAddress(wallet.wallet_address));
        await connection.execute(
          `INSERT INTO reward_run_items
            (run_id, sequence, chain_id, wallet_id, claimant_address, campaign_id, policy,
             policy_scope, reward_amount_wei, action, classification, lifecycle_state)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
          [input.runId, sequence, campaign.chain_id, wallet.id, getAddress(wallet.wallet_address),
            campaign.campaign_id, campaign.policy, campaign.policy_scope, campaign.reward_amount_wei,
            initial.action, initial.classification],
        );
      }
      await connection.commit();
      return { runId: input.runId, status: "READY", targetWalletCount: wallets.length };
    } catch (error: unknown) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  public async startRun(runId: string, at: Date = new Date()): Promise<boolean> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE reward_runs r JOIN reward_campaign_operations c ON c.id = r.campaign_operation_id
          SET r.status = 'RUNNING', r.started_at = COALESCE(r.started_at, ?),
              c.operational_status = 'ACTIVE', c.next_dispatch_at = COALESCE(c.next_dispatch_at, ?)
        WHERE r.run_id = ? AND r.status = 'READY' AND c.operational_status IN ('READY','ACTIVE')`,
      [at, at, runId],
    );
    return result.affectedRows > 0;
  }

  public async stopRun(runId: string, at: Date = new Date()): Promise<boolean> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute<ResultSetHeader>(
        "UPDATE reward_runs SET status = 'STOPPED', completed_at = ? WHERE run_id = ? AND status IN ('READY','RUNNING','PAUSED')",
        [at, runId],
      );
      if (result.affectedRows === 1) {
        await connection.execute(
          `UPDATE reward_run_items SET action = 'RUN_STOPPED', classification = 'SKIPPED',
             lifecycle_state = 'FINALIZED', completed_at = ?
           WHERE run_id = ? AND lifecycle_state = 'PENDING' AND classification IN ('PENDING','READY')`,
          [at, runId],
        );
      }
      await connection.commit();
      return result.affectedRows === 1;
    } catch (error: unknown) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}

async function classifyInitialItem(
  connection: PoolConnection, campaign: CampaignRow, claimant: string,
): Promise<{ readonly action: string | null; readonly classification: "PENDING" | "SKIPPED" | "RECONCILIATION_REQUIRED" }> {
  if (campaign.policy === "RECURRING") return { action: null, classification: "PENDING" };
  const scopeColumn = campaign.policy === "FIRST_REWARD_ONLY" ? "policy_scope" : "campaign_id";
  const scopeValue = campaign.policy === "FIRST_REWARD_ONLY" ? campaign.policy_scope : campaign.campaign_id;
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT classification, lifecycle_state FROM reward_run_items
      WHERE chain_id = ? AND policy = ? AND ${scopeColumn} = ? AND claimant_address = ?
        AND (classification IN ('CONFIRMED','RECONCILIATION_REQUIRED')
             OR lifecycle_state IN ('AUTHORIZED','SIGNED','BROADCAST','PENDING_REVIEW'))
      ORDER BY id DESC LIMIT 1 FOR UPDATE`,
    [campaign.chain_id, campaign.policy, scopeValue, claimant],
  );
  const prior = rows[0];
  if (!prior) return { action: null, classification: "PENDING" };
  if (prior.classification === "CONFIRMED") {
    return {
      action: campaign.policy === "FIRST_REWARD_ONLY" ? "SKIP_ALREADY_REWARDED" : "SKIP_ONCE_PER_CAMPAIGN",
      classification: "SKIPPED",
    };
  }
  return { action: "RECONCILIATION_REQUIRED", classification: "RECONCILIATION_REQUIRED" };
}
