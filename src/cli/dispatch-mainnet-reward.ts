import "dotenv/config";

import { hostname } from "node:os";

import { getAddress, JsonRpcProvider } from "ethers";
import type { RowDataPacket } from "mysql2/promise";

import { MySqlAuthorizationRepository } from "../authorization/authorization-repository.js";
import type { RewardEligibilityService } from "../authorization/authorization-types.js";
import { createRewardAuthorizationDomain } from "../authorization/eip712.js";
import {
  createBatchInspection, createBatchRunnerDependencies, createExistingClaimLifecycle,
} from "../batch/existing-claim-lifecycle.js";
import { MySqlClaimRepository } from "../claim/claim-repository.js";
import { ClaimChainReadFailover, ClaimReadFailoverProvider, ClaimTokenReadFailover } from "../claim/claim-rpc.js";
import type { ClaimProvider } from "../claim/claim-types.js";
import { AURX_EXPECTED_DECIMALS, BSC_MAINNET_CHAIN_ID } from "../config/constants.js";
import { loadMainnetEnvironment, requireMainnetClaimRuntime } from "../config/mainnet-environment.js";
import { IrbTokenClient } from "../contracts/irb-token-client.js";
import { RewardContractClient } from "../contracts/reward-contract-client.js";
import { createDatabasePool } from "../database/pool.js";
import { createProductionClaimExecutor } from "../production/existing-claim-executor.js";
import { dispatchOne } from "../production/global-dispatcher.js";
import { calculateInventoryReadiness } from "../production/inventory-readiness.js";
import { MySqlProductionRepository } from "../production/production-repository.js";
import { MySqlWalletRepository } from "../wallets/wallet-repository.js";
import { runCommand } from "./run-command.js";

interface CampaignRow extends RowDataPacket { readonly campaign_id: string }
const productionEligibility: RewardEligibilityService = {
  evaluate: () => Promise.resolve({ eligible: true, reason: "PRODUCTION_POLICY_PRECHECKED", source: "PRODUCTION_ELIGIBILITY" }),
};

await runCommand("mainnet:run:dispatch", async () => {
  const config = loadMainnetEnvironment();
  const runtime = requireMainnetClaimRuntime(config);
  const rewardContractAddress = config.rewardContractAddress as string;
  const urls = [runtime.primaryRpcUrl, config.rpc.secondaryUrl].filter((url): url is string => Boolean(url));
  const providers = (await Promise.all(urls.map(async (url) => {
    const provider = new JsonRpcProvider(url, BSC_MAINNET_CHAIN_ID, { staticNetwork: true });
    try {
      return Number((await provider.getNetwork()).chainId) === BSC_MAINNET_CHAIN_ID ? provider : undefined;
    } catch {
      provider.destroy();
      return undefined;
    }
  }))).filter((provider): provider is JsonRpcProvider => provider !== undefined);
  if (providers.length === 0) throw new Error("NO_HEALTHY_MAINNET_RPC");
  const pool = createDatabasePool(runtime.database);
  try {
    const primary = providers[0];
    if (!primary) throw new Error("NO_PRIMARY_MAINNET_RPC");
    const rewardClients = providers.map((provider) => new RewardContractClient(provider, rewardContractAddress));
    const tokenClients = providers.map((provider) => new IrbTokenClient(provider, config.aurxAddress));
    const [rewardCode, tokenCode, rewardInspection, tokenInspection] = await Promise.all([
      primary.getCode(rewardContractAddress), primary.getCode(config.aurxAddress),
      rewardClients[0]?.inspect(), tokenClients[0]?.inspect(),
    ]);
    if (rewardCode === "0x" || tokenCode === "0x" || !rewardInspection || !tokenInspection) throw new Error("MAINNET_CONTRACT_CODE_MISSING");
    if (rewardInspection.rewardToken !== config.aurxAddress || tokenInspection.decimals !== AURX_EXPECTED_DECIMALS) throw new Error("MAINNET_REWARD_TOKEN_MISMATCH");
    if (rewardInspection.domain.chainId !== BSC_MAINNET_CHAIN_ID ||
        rewardInspection.domain.verifyingContract !== getAddress(rewardContractAddress) ||
        rewardInspection.domain.name !== "AurixRewardClaim" || rewardInspection.domain.version !== "1") {
      throw new Error("MAINNET_EIP712_DOMAIN_MISMATCH");
    }
    const [campaignRows] = await pool.execute<CampaignRow[]>(
      "SELECT campaign_id FROM reward_campaign_operations WHERE chain_id = 56 AND operational_status = 'ACTIVE'",
    );
    const campaigns = await Promise.all(campaignRows.map(async ({ campaign_id }) => {
      const state = await rewardClients[0]?.getCampaign(campaign_id);
      if (!state) throw new Error("MAINNET_CAMPAIGN_READ_FAILED");
      return { active: state.active, budget: state.budget, campaignId: campaign_id, distributed: state.distributed };
    }));
    const inventory = calculateInventoryReadiness(campaigns, await tokenClients[0]!.balanceOf(rewardContractAddress));
    if (!inventory.inventoryReady) throw new Error("AGGREGATE_MAINNET_INVENTORY_RISK");

    const claimProviders = providers as unknown as readonly ClaimProvider[];
    const primaryProvider = new ClaimReadFailoverProvider(claimProviders);
    const reader = new ClaimChainReadFailover(rewardClients);
    const token = new ClaimTokenReadFailover(tokenClients);
    const authorizationRepository = new MySqlAuthorizationRepository(pool);
    const claimRepository = new MySqlClaimRepository(pool);
    const walletRepository = MySqlWalletRepository.create(pool);
    const wallets = {
      findEncryptedById: (id: string) => walletRepository.findMainnetEncryptedById(id),
      findPublicById: (id: string) => walletRepository.findMainnetPublicById(id),
    };
    const executor = createProductionClaimExecutor((item) => {
      const args = { amount: item.rewardAmount, campaignId: item.campaignId, walletIdEnd: Number(item.walletId), walletIdStart: Number(item.walletId) };
      const lifecycle = createExistingClaimLifecycle({
        approver: runtime.approver, args, authorizationReader: rewardClients[0]!, authorizationRepository,
        broadcastProviders: claimProviders, claimReader: reader, claimRepository,
        eip712Domain: createRewardAuthorizationDomain(BSC_MAINNET_CHAIN_ID, rewardContractAddress),
        eligibility: productionEligibility, encryption: runtime.walletEncryption, executionEnabled: true,
        expectedApprover: runtime.approver.address, expectedChainId: BSC_MAINNET_CHAIN_ID,
        irbTokenAddress: config.aurxAddress,
        ...(config.claim.maxGasPriceWei === undefined ? {} : { maxGasPriceWei: config.claim.maxGasPriceWei }),
        primaryProvider, rewardContractAddress, token, validitySeconds: runtime.authorizationValiditySeconds,
      });
      return createBatchRunnerDependencies({
        authorizationJobs: authorizationRepository, claimJobs: claimRepository,
        inspection: createBatchInspection({ provider: primaryProvider, rewardContractAddress, token }),
        irbTokenAddress: config.aurxAddress, lifecycle,
        ...(config.claim.maxGasPriceWei === undefined ? {} : { maxGasPriceWei: config.claim.maxGasPriceWei }),
        rewardContractAddress, wallets,
      });
    });
    return await dispatchOne({
      dispatcherLeaseSeconds: config.dispatcher.dispatcherLeaseSeconds, executor,
      ownerId: `${hostname()}:${process.pid}`, repository: new MySqlProductionRepository(pool),
      walletLeaseSeconds: config.dispatcher.walletLeaseSeconds,
    });
  } finally {
    await pool.end();
    providers.forEach((provider) => provider.destroy());
  }
});
