import { ZeroHash } from "ethers";

import {
  createAndSignRewardAuthorization,
  planRewardAuthorization,
} from "../authorization/authorization-service.js";
import type {
  CampaignAuthorizationReader,
  RewardEligibilityService,
} from "../authorization/authorization-types.js";
import type { ApproverConfig, WalletEncryptionConfig } from "../config/environment.js";
import { buildClaimPlan } from "../claim/claim-plan.js";
import type { ClaimRepository } from "../claim/claim-repository.js";
import { executeClaim, reconcileClaimJobs } from "../claim/claim-service.js";
import type {
  ClaimChainReader,
  ClaimProvider,
  ClaimTokenReader,
} from "../claim/claim-types.js";
import type { AuthorizationRepository } from "../authorization/authorization-repository.js";

import type {
  BatchClaimLifecycle,
  BatchCommandArgs,
  BatchInspection,
  BatchRunnerDependencies,
} from "./batch-types.js";

export interface ExistingClaimLifecycleInput {
  readonly approver?: ApproverConfig;
  readonly args: BatchCommandArgs;
  readonly authorizationReader: CampaignAuthorizationReader;
  readonly authorizationRepository: AuthorizationRepository;
  readonly broadcastProviders: readonly ClaimProvider[];
  readonly claimReader: ClaimChainReader;
  readonly claimRepository: ClaimRepository;
  readonly eligibility: RewardEligibilityService;
  readonly encryption?: WalletEncryptionConfig;
  readonly executionEnabled: boolean;
  readonly expectedApprover: string;
  readonly irbTokenAddress: string;
  readonly maxGasPriceWei?: bigint;
  readonly primaryProvider: ClaimProvider;
  readonly rewardContractAddress: string;
  readonly token: ClaimTokenReader;
  readonly validitySeconds: number;
}

export function createExistingClaimLifecycle(
  input: ExistingClaimLifecycleInput,
): BatchClaimLifecycle {
  return {
    buildClaimPlan: (authorization, wallet, existingJob) => buildClaimPlan({
      authorization,
      ...(existingJob ? { existingJob } : {}),
      expectedApprover: input.expectedApprover,
      irbTokenAddress: input.irbTokenAddress,
      ...(input.maxGasPriceWei === undefined
        ? {}
        : { maxGasPriceWei: input.maxGasPriceWei }),
      provider: input.primaryProvider,
      reader: input.claimReader,
      rewardContractAddress: input.rewardContractAddress,
      token: input.token,
      wallet,
    }),
    createAuthorization: (wallet, nowSeconds) => {
      if (!input.approver) {
        throw new Error("Approver configuration is unavailable in read-only mode");
      }
      return createAndSignRewardAuthorization({
        amount: input.args.amount,
        approverAddress: input.approver.address,
        approverPrivateKey: input.approver.privateKey,
        campaignId: input.args.campaignId,
        clock: () => Math.floor(Date.now() / 1_000),
        eligibility: input.eligibility,
        nowSeconds,
        reader: input.authorizationReader,
        repository: input.authorizationRepository,
        validitySeconds: input.validitySeconds,
        wallet,
      });
    },
    executeClaim: (authorization, plan, wallet) => {
      if (!input.encryption) {
        throw new Error("Wallet encryption configuration is unavailable in read-only mode");
      }
      return executeClaim({
        authorization,
        broadcastProviders: input.broadcastProviders,
        encryption: input.encryption,
        executionEnabled: input.executionEnabled,
        plan,
        reader: input.claimReader,
        repository: input.claimRepository,
        rewardContractAddress: input.rewardContractAddress,
        token: input.token,
        wallet,
      });
    },
    getRewardNonce: (campaignId, claimant) =>
      input.authorizationReader.getRewardNonce(campaignId, claimant),
    isRewardIdUsed: (rewardId) => input.authorizationReader.isRewardIdUsed(rewardId),
    planAuthorization: (wallet, nowSeconds) => planRewardAuthorization({
      amount: input.args.amount,
      campaignId: input.args.campaignId,
      eligibility: input.eligibility,
      nowSeconds,
      reader: input.authorizationReader,
      rewardId: ZeroHash,
      validitySeconds: input.validitySeconds,
      wallet,
    }),
    reconcileClaims: () => reconcileClaimJobs({
      authorizationRepository: input.authorizationRepository,
      providers: input.broadcastProviders,
      reader: input.claimReader,
      repository: input.claimRepository,
      rewardContractAddress: input.rewardContractAddress,
      token: input.token,
    }),
  };
}

export function createBatchInspection(input: {
  readonly provider: ClaimProvider;
  readonly rewardContractAddress: string;
  readonly token: ClaimTokenReader;
}): BatchInspection {
  return {
    getBalance: (address) => input.provider.getBalance(address),
    getBlock: (tag) => input.provider.getBlock(tag),
    getFeeData: () => input.provider.getFeeData(),
    getIrbBalance: (address) => input.token.balanceOf(address),
    getRewardContractIrbBalance: () =>
      input.token.balanceOf(input.rewardContractAddress),
  };
}

export function createBatchRunnerDependencies(input: {
  readonly authorizationJobs: BatchRunnerDependencies["authorizationJobs"];
  readonly claimJobs: BatchRunnerDependencies["claimJobs"];
  readonly inspection: BatchInspection;
  readonly irbTokenAddress: string;
  readonly lifecycle: BatchClaimLifecycle;
  readonly maxGasPriceWei?: bigint;
  readonly rewardContractAddress: string;
  readonly wallets: BatchRunnerDependencies["wallets"];
}): BatchRunnerDependencies {
  return {
    authorizationJobs: input.authorizationJobs,
    claimJobs: input.claimJobs,
    inspection: input.inspection,
    irbTokenAddress: input.irbTokenAddress,
    lifecycle: input.lifecycle,
    ...(input.maxGasPriceWei === undefined
      ? {}
      : { maxGasPriceWei: input.maxGasPriceWei }),
    rewardContractAddress: input.rewardContractAddress,
    wallets: input.wallets,
  };
}
