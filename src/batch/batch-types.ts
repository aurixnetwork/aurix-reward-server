import type { AuthorizationJobRecord, AuthorizationPlanResult } from "../authorization/authorization-types.js";
import type { ClaimExecutionResult } from "../claim/claim-service.js";
import type { ClaimJobRecord, ClaimPlan } from "../claim/claim-types.js";
import type { EncryptedWalletRecord, PublicWalletRecord } from "../wallets/wallet-types.js";

export type BatchMode = "PLAN" | "EXECUTE";

export type BatchItemClassification =
  | "READY"
  | "EXPECTED_BLOCKER"
  | "SKIPPED"
  | "RECONCILIATION_REQUIRED"
  | "CONFIRMED"
  | "FAILED"
  | "SYSTEM_ERROR";

export type BatchWalletAction = string;

export interface BatchBlocker {
  readonly code: string;
  readonly reason: string;
}

export interface BatchCommandArgs {
  readonly amount: bigint;
  readonly campaignId: string;
  readonly walletIdEnd: number;
  readonly walletIdStart: number;
}

export interface BatchSafeError {
  readonly code: string;
  readonly stage?: string;
  readonly type: string;
}

export interface BatchWalletItem {
  readonly action: BatchWalletAction;
  readonly actualFeeWei?: bigint;
  readonly authorizationJobId?: string;
  readonly blockers: readonly BatchBlocker[];
  readonly campaignRemainingBudget?: bigint;
  readonly claimJobId?: string;
  readonly claimant?: string;
  readonly classification: BatchItemClassification;
  readonly estimatedFeeWei?: bigint;
  readonly irbBalance?: bigint;
  readonly nextClaimAt?: bigint;
  readonly rewardContractIrbBalance?: bigint;
  readonly rewardNonce?: bigint;
  readonly safeError?: BatchSafeError;
  readonly transactionHash?: string;
  readonly transactionsSent: number;
  readonly userGasBalanceWei?: bigint;
  readonly walletId: string;
}

export interface BatchRunResult {
  readonly actualGasWei: bigint;
  readonly batchRunId: string;
  readonly blocked: number;
  readonly campaignId: string;
  readonly completedAt: string;
  readonly concurrency: 1;
  readonly confirmed: number;
  readonly estimatedGasWei: bigint;
  readonly failed: number;
  readonly items: readonly BatchWalletItem[];
  readonly mode: BatchMode;
  readonly processed: number;
  readonly reconciliationRequired: number;
  readonly requestedWallets: number;
  readonly skipped: number;
  readonly startedAt: string;
  readonly status: "COMPLETED" | "ABORTED_SYSTEM_ERROR" | "ABORTED_UNCERTAIN_CLAIM";
  readonly systemError?: BatchSafeError;
  readonly totalRewardAmount: bigint;
  readonly transactionsSent: number;
  readonly walletIdEnd: number;
  readonly walletIdStart: number;
}

export interface BatchAuthorizationJobs {
  findByJobId?(jobId: string): Promise<AuthorizationJobRecord | undefined>;
  listActiveByCampaignClaimant(
    campaignId: string,
    claimant: string,
  ): Promise<readonly AuthorizationJobRecord[]>;
}

export interface BatchClaimJobs {
  findLatestByWalletCampaign?(
    walletId: string,
    campaignId: string,
  ): Promise<ClaimJobRecord | undefined>;
  findByAuthorizationJobId(
    authorizationJobId: string,
  ): Promise<ClaimJobRecord | undefined>;
  findUnresolvedByWalletCampaign(
    walletId: string,
    campaignId: string,
  ): Promise<ClaimJobRecord | undefined>;
}

export interface BatchWallets {
  findEncryptedById(id: string): Promise<EncryptedWalletRecord | undefined>;
  findPublicById(id: string): Promise<PublicWalletRecord | undefined>;
}

export interface BatchInspection {
  getBlock(tag: "latest"): Promise<{ readonly timestamp: number } | null>;
  getBalance(address: string): Promise<bigint>;
  getFeeData(): Promise<{ readonly gasPrice: bigint | null }>;
  getIrbBalance(address: string): Promise<bigint>;
  getRewardContractIrbBalance(): Promise<bigint>;
}

export interface BatchClaimLifecycle {
  buildClaimPlan(
    authorization: AuthorizationJobRecord,
    wallet: PublicWalletRecord,
    existingJob?: ClaimJobRecord,
  ): Promise<ClaimPlan>;
  createAuthorization(
    wallet: PublicWalletRecord,
    nowSeconds: number,
  ): Promise<AuthorizationJobRecord>;
  executeClaim(
    authorization: AuthorizationJobRecord,
    plan: ClaimPlan,
    wallet: EncryptedWalletRecord,
  ): Promise<ClaimExecutionResult>;
  getRewardNonce(campaignId: string, claimant: string): Promise<bigint>;
  isRewardIdUsed(rewardId: string): Promise<boolean>;
  planAuthorization(
    wallet: PublicWalletRecord,
    nowSeconds: number,
  ): Promise<AuthorizationPlanResult>;
  reconcileClaims(): Promise<{ readonly inspected: number; readonly updated: number }>;
}

export interface BatchRunnerDependencies {
  readonly authorizationJobs: BatchAuthorizationJobs;
  readonly claimJobs: BatchClaimJobs;
  readonly inspection: BatchInspection;
  readonly irbTokenAddress: string;
  readonly lifecycle: BatchClaimLifecycle;
  readonly maxGasPriceWei?: bigint;
  readonly rewardContractAddress: string;
  readonly wallets: BatchWallets;
}

export interface PreparedBatchWallet {
  readonly authorization?: AuthorizationJobRecord;
  readonly claimPlan?: ClaimPlan;
  readonly encryptedWallet?: EncryptedWalletRecord;
  readonly item: BatchWalletItem;
  readonly publicWallet?: PublicWalletRecord;
}

export class BatchRunAbortedError extends Error {
  public constructor(public readonly report: BatchRunResult) {
    super("Batch execution stopped at a systemic or uncertain safety boundary");
    this.name = "BatchRunAbortedError";
  }
}
