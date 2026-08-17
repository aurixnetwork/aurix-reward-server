import "dotenv/config";

import { formatEther, JsonRpcProvider } from "ethers";
import type { RowDataPacket } from "mysql2/promise";

import { loadMainnetEnvironment } from "../config/mainnet-environment.js";
import { createDatabasePool } from "../database/pool.js";
import { calculateGasReadiness } from "../production/gas-readiness.js";
import { runCommand } from "./run-command.js";

interface WalletRow extends RowDataPacket { readonly id: number | string; readonly wallet_address: string }

await runCommand("mainnet:gas:readiness", async () => {
  const config = loadMainnetEnvironment();
  if (!config.rpc.primaryUrl || !config.database || !config.claim.estimatedClaimGas) {
    throw new Error("BSC_MAINNET_RPC_URL, DB configuration, and ESTIMATED_CLAIM_GAS are required");
  }
  const provider = new JsonRpcProvider(config.rpc.primaryUrl, config.chainId, { staticNetwork: true });
  const pool = createDatabasePool(config.database);
  try {
    const [network, feeData, rows] = await Promise.all([
      provider.getNetwork(), provider.getFeeData(),
      pool.execute<WalletRow[]>("SELECT id, wallet_address FROM reward_user_wallets WHERE network_profile = 'MAINNET' AND status = 'ACTIVE' ORDER BY id"),
    ]);
    if (Number(network.chainId) !== config.chainId || !feeData.gasPrice) throw new Error("MAINNET_GAS_READ_FAILED");
    const wallets = await Promise.all(rows[0].map(async (wallet) => ({
      address: wallet.wallet_address, balanceWei: await provider.getBalance(wallet.wallet_address), walletId: String(wallet.id),
    })));
    const report = calculateGasReadiness({ estimatedClaimGas: config.claim.estimatedClaimGas, gasPriceWei: feeData.gasPrice, wallets });
    return {
      gasPriceWei: report.gasPriceWei.toString(), estimatedClaimGas: report.estimatedClaimGas.toString(),
      feePerWalletBnb: formatEther(report.feePerWalletWei),
      wallets: report.wallets.map((wallet) => ({ address: wallet.address, balanceBnb: formatEther(wallet.balanceWei), deficitBnb: formatEther(wallet.deficitWei), ready: wallet.ready, walletId: wallet.walletId })),
      canary5EstimateBnb: formatEther(report.canary5EstimateWei), canary10EstimateBnb: formatEther(report.canary10EstimateWei),
      pilot100EstimateBnb: formatEther(report.pilot100EstimateWei), aggregateFundingRequirementBnb: formatEther(report.aggregateFundingRequirementWei),
      gasReady: report.gasReady, transactionsSent: report.transactionsSent,
    };
  } finally {
    provider.destroy();
    await pool.end();
  }
});
