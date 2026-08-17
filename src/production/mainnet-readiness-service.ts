import { Contract, JsonRpcProvider } from "ethers";
import type { Pool, RowDataPacket } from "mysql2/promise";

import type { MainnetProductionConfig } from "../config/mainnet-environment.js";
import { createDatabasePool } from "../database/pool.js";
import { IrbTokenClient } from "../contracts/irb-token-client.js";
import { RewardContractClient } from "../contracts/reward-contract-client.js";
import { calculateInventoryReadiness } from "./inventory-readiness.js";
import { calculateMainnetReadiness, type MainnetReadinessObservations } from "./mainnet-readiness.js";

const TOKEN_ABI = ["function decimals() view returns (uint8)"];
const REWARD_ABI = ["function rewardToken() view returns (address)"];
const REQUIRED_PRODUCTION_TABLES = [
  "reward_campaign_operations", "reward_runs", "reward_run_items",
  "wallet_execution_leases", "reward_dispatcher_leases",
] as const;

interface CountRow extends RowDataPacket { readonly count: number }
interface MigrationRow extends RowDataPacket { readonly filename: string }
interface TableRow extends RowDataPacket { readonly table_name: string }
interface CampaignRow extends RowDataPacket { readonly campaign_id: string }
interface WalletRow extends RowDataPacket { readonly wallet_address: string }

export async function collectMainnetReadiness(config: MainnetProductionConfig) {
  const database = config.database ? await inspectDatabase(createDatabasePool(config.database)) : emptyDatabase();
  let observedChainId: number | undefined;
  let aurxCodePresent = false;
  let aurxDecimals: number | undefined;
  let rewardContractCodePresent = false;
  let rewardContractToken: string | undefined;
  let gasPriceAvailable = false;
  let gasReady = false;
  let inventoryReady = false;
  if (config.rpc.primaryUrl) {
    const provider = new JsonRpcProvider(config.rpc.primaryUrl, config.chainId, { staticNetwork: true });
    try {
      const [network, aurxCode, decimals, feeData] = await Promise.all([
        provider.getNetwork(),
        provider.getCode(config.aurxAddress),
        new Contract(config.aurxAddress, TOKEN_ABI, provider).getFunction("decimals")() as Promise<bigint>,
        provider.getFeeData(),
      ]);
      observedChainId = Number(network.chainId);
      aurxCodePresent = aurxCode !== "0x";
      aurxDecimals = Number(decimals);
      gasPriceAvailable = feeData.gasPrice !== null && feeData.gasPrice > 0n;
      if (config.rewardContractAddress) {
        const [code, token] = await Promise.all([
          provider.getCode(config.rewardContractAddress),
          new Contract(config.rewardContractAddress, REWARD_ABI, provider).getFunction("rewardToken")() as Promise<string>,
        ]);
        rewardContractCodePresent = code !== "0x";
        rewardContractToken = token;
        if (rewardContractCodePresent) {
          const reward = new RewardContractClient(provider, config.rewardContractAddress);
          const tokenClient = new IrbTokenClient(provider, config.aurxAddress);
          const campaigns = await Promise.all(database.activeCampaignIds.map(async (campaignId) => {
            const state = await reward.getCampaign(campaignId);
            return { active: state.active, budget: state.budget, campaignId, distributed: state.distributed };
          }));
          inventoryReady = database.activeCampaignIds.length > 0 && calculateInventoryReadiness(
            campaigns, await tokenClient.balanceOf(config.rewardContractAddress),
          ).inventoryReady;
          if (feeData.gasPrice && config.claim.estimatedClaimGas && database.walletAddresses.length >= 5) {
            const required = feeData.gasPrice * config.claim.estimatedClaimGas;
            const balances = await Promise.all(database.walletAddresses.map((address) => provider.getBalance(address)));
            gasReady = balances.every((balance) => balance >= required);
          }
        }
      }
    } catch {
      // Individual readiness flags remain false. The report is fail-closed.
    } finally {
      provider.destroy();
    }
  }

  const migrationsReady = REQUIRED_PRODUCTION_TABLES.every((table) => database.tables.has(table)) &&
    database.migrations.has("0012_create_reward_dispatcher_leases.sql");
  const observations: MainnetReadinessObservations = {
    ...(observedChainId === undefined ? {} : { observedChainId }),
    aurxCodePresent,
    ...(aurxDecimals === undefined ? {} : { aurxDecimals }),
    rewardContractCodePresent,
    ...(rewardContractToken ? { rewardContractToken } : {}),
    databaseReady: database.connected,
    migrationReady: migrationsReady,
    multiCampaignReady: migrationsReady,
    dispatcherReady: migrationsReady,
    walletLockReady: migrationsReady,
    durableRunsReady: migrationsReady,
    pauseResumeReady: migrationsReady,
    walletCount: database.walletCount,
    campaignReady: database.activeCampaignCount > 0,
    gasReady: gasPriceAvailable && gasReady,
    inventoryReady,
  };
  return {
    checkedAt: new Date().toISOString(),
    profile: config.profile,
    chainId: config.chainId,
    aurxAddress: config.aurxAddress,
    rewardContractAddress: config.rewardContractAddress ?? null,
    ...calculateMainnetReadiness(config, observations),
  };
}

async function inspectDatabase(pool: Pool): Promise<{
  readonly connected: boolean;
  readonly tables: ReadonlySet<string>;
  readonly migrations: ReadonlySet<string>;
  readonly walletCount: number;
  readonly activeCampaignCount: number;
  readonly activeCampaignIds: readonly string[];
  readonly walletAddresses: readonly string[];
}> {
  try {
    await pool.query("SELECT 1");
    const [tableRows] = await pool.execute<TableRow[]>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()",
    );
    const tables = new Set(tableRows.map((row) => row.table_name));
    const migrations = tables.has("schema_migrations")
      ? new Set((await pool.execute<MigrationRow[]>("SELECT filename FROM schema_migrations"))[0].map((row) => row.filename))
      : new Set<string>();
    let walletCount = 0;
    let walletAddresses: string[] = [];
    if (tables.has("reward_user_wallets") && tables.has("reward_runs")) {
      const [rows] = await pool.execute<CountRow[]>(
        "SELECT COUNT(*) AS count FROM reward_user_wallets WHERE network_profile = 'MAINNET' AND status = 'ACTIVE'",
      );
      walletCount = Number(rows[0]?.count ?? 0);
      const [walletRows] = await pool.execute<WalletRow[]>(
        "SELECT wallet_address FROM reward_user_wallets WHERE network_profile = 'MAINNET' AND status = 'ACTIVE' ORDER BY id",
      );
      walletAddresses = walletRows.map((row) => row.wallet_address);
    }
    let activeCampaignCount = 0;
    let activeCampaignIds: string[] = [];
    if (tables.has("reward_campaign_operations")) {
      const [rows] = await pool.execute<CountRow[]>(
        "SELECT COUNT(*) AS count FROM reward_campaign_operations WHERE chain_id = 56 AND operational_status = 'ACTIVE'",
      );
      activeCampaignCount = Number(rows[0]?.count ?? 0);
      const [campaignRows] = await pool.execute<CampaignRow[]>(
        "SELECT campaign_id FROM reward_campaign_operations WHERE chain_id = 56 AND operational_status = 'ACTIVE' ORDER BY id",
      );
      activeCampaignIds = campaignRows.map((row) => row.campaign_id);
    }
    return { activeCampaignCount, activeCampaignIds, connected: true, migrations, tables, walletAddresses, walletCount };
  } catch {
    return emptyDatabase();
  } finally {
    await pool.end();
  }
}

function emptyDatabase() {
  return {
    activeCampaignCount: 0,
    activeCampaignIds: [] as string[],
    connected: false,
    migrations: new Set<string>(),
    tables: new Set<string>(),
    walletAddresses: [] as string[],
    walletCount: 0,
  };
}
