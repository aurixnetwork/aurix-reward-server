import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

async function migration(name: string): Promise<string> {
  return readFile(new URL(`../database/migrations/${name}`, import.meta.url), "utf8");
}

describe("Production durable-state migrations", () => {
  it("designates Wallet network profiles without converting existing Testnet rows", async () => {
    const sql = await migration("0007_add_wallet_network_profile.sql");
    expect(sql).toContain("DEFAULT 'TESTNET'");
    expect(sql).toContain("'MAINNET'");
  });

  it("stores independent Campaign dispatch intervals and due times", async () => {
    const sql = await migration("0008_create_reward_campaign_operations.sql");
    expect(sql).toContain("dispatch_interval_seconds");
    expect(sql).toContain("next_dispatch_at");
    expect(sql).toContain("FIRST_REWARD_ONLY");
  });

  it("stores all durable Run counters and pause/resume timestamps", async () => {
    const sql = await migration("0009_create_reward_runs.sql");
    for (const column of ["processed_count", "confirmed_count", "already_rewarded_count", "reconciliation_required_count", "transactions_sent", "total_reward_wei", "total_gas_wei", "paused_at", "resumed_at"]) expect(sql).toContain(column);
  });

  it("enforces one Run Item per Run, Campaign, and Wallet", async () => {
    expect(await migration("0010_create_reward_run_items.sql")).toContain("uq_reward_run_items_run_campaign_wallet");
  });

  it("preserves rewardNonce separately from Ethereum claim tx_nonce", async () => {
    const itemSql = await migration("0010_create_reward_run_items.sql");
    const claimSql = await migration("0005_create_reward_claim_jobs.sql");
    expect(itemSql).toContain("reward_nonce");
    expect(claimSql).toContain("tx_nonce");
  });

  it("provides durable Wallet lease ownership, token, and expiry", async () => {
    const sql = await migration("0011_create_wallet_execution_leases.sql");
    expect(sql).toContain("owner_id");
    expect(sql).toContain("lease_token");
    expect(sql).toContain("expires_at");
    expect(sql).toContain("PRIMARY KEY (chain_id, wallet_address)");
  });

  it("provides the singleton global dispatcher lease", async () => {
    expect(await migration("0012_create_reward_dispatcher_leases.sql")).toContain("dispatcher_key");
  });

  it("stores no private keys or raw signed transaction", async () => {
    const sql = (await Promise.all([8, 9, 10, 11, 12].map((number) => migration(`${String(number).padStart(4, "0")}_${[
      "", "", "", "", "", "", "", "", "create_reward_campaign_operations", "create_reward_runs", "create_reward_run_items", "create_wallet_execution_leases", "create_reward_dispatcher_leases",
    ][number]}.sql`)))).join("\n");
    expect(sql).not.toMatch(/private_key|raw_transaction|mnemonic/i);
  });
});
