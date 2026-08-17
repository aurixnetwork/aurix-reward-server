import { getAddress } from "ethers";

import { AURX_EXPECTED_DECIMALS, AURX_MAINNET_TOKEN_ADDRESS, BSC_MAINNET_CHAIN_ID } from "../config/constants.js";
import type { MainnetProductionConfig } from "../config/mainnet-environment.js";

export interface MainnetReadinessObservations {
  readonly observedChainId?: number;
  readonly aurxCodePresent?: boolean;
  readonly aurxDecimals?: number;
  readonly rewardContractCodePresent?: boolean;
  readonly rewardContractToken?: string;
  readonly databaseReady: boolean;
  readonly migrationReady: boolean;
  readonly multiCampaignReady: boolean;
  readonly dispatcherReady: boolean;
  readonly walletLockReady: boolean;
  readonly durableRunsReady: boolean;
  readonly pauseResumeReady: boolean;
  readonly walletCount: number;
  readonly campaignReady: boolean;
  readonly gasReady: boolean;
  readonly inventoryReady: boolean;
}

export function calculateMainnetReadiness(
  config: MainnetProductionConfig,
  observed: MainnetReadinessObservations,
) {
  const networkReady = observed.observedChainId === BSC_MAINNET_CHAIN_ID;
  const aurxReady = observed.aurxCodePresent === true &&
    observed.aurxDecimals === AURX_EXPECTED_DECIMALS &&
    config.aurxAddress === getAddress(AURX_MAINNET_TOKEN_ADDRESS);
  const rewardContractReady = Boolean(
    config.rewardContractAddress && observed.rewardContractCodePresent === true &&
    observed.rewardContractToken && getAddress(observed.rewardContractToken) === config.aurxAddress,
  );
  const executionGuardsReady = config.execution.mainnetEnabled && config.execution.claimEnabled;
  const walletCapacityReady = observed.walletCount >= 5;
  const canaryReady = networkReady && aurxReady && rewardContractReady && observed.databaseReady &&
    observed.migrationReady && observed.campaignReady && observed.gasReady && observed.inventoryReady &&
    walletCapacityReady && executionGuardsReady;
  const pilot100Ready = canaryReady && observed.walletCount >= 100;
  const report = {
    networkReady,
    aurxReady,
    rewardContractReady,
    databaseReady: observed.databaseReady,
    migrationReady: observed.migrationReady,
    multiCampaignReady: observed.multiCampaignReady,
    dispatcherReady: observed.dispatcherReady,
    walletLockReady: observed.walletLockReady,
    durableRunsReady: observed.durableRunsReady,
    pauseResumeReady: observed.pauseResumeReady,
    walletCapacityReady,
    campaignReady: observed.campaignReady,
    gasReady: observed.gasReady,
    inventoryReady: observed.inventoryReady,
    executionGuardsReady,
    canaryReady,
    pilot100Ready,
    transactionsSent: 0 as const,
  };
  return { ...report, overallReady: Object.entries(report).filter(([key]) => key !== "transactionsSent").every(([, value]) => value === true) };
}
