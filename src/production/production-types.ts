export type CampaignPolicy = "FIRST_REWARD_ONLY" | "ONCE_PER_CAMPAIGN" | "RECURRING";
export type RewardRunStatus =
  | "DRAFT" | "READY" | "RUNNING" | "PAUSED" | "COMPLETED"
  | "COMPLETED_WITH_EXCEPTIONS" | "STOPPED" | "FAILED";
export type RunItemClassification =
  | "PENDING" | "READY" | "SKIPPED" | "BLOCKED"
  | "RECONCILIATION_REQUIRED" | "CONFIRMED" | "FAILED" | "SYSTEM_ERROR";
export type RunItemLifecycleState =
  | "PENDING" | "ACQUIRED" | "AUTHORIZED" | "SIGNED"
  | "BROADCAST" | "PENDING_REVIEW" | "FINALIZED";

export interface ProductionCampaign {
  readonly id: string;
  readonly campaignId: string;
  readonly campaignName: string;
  readonly policy: CampaignPolicy;
  readonly policyScope: string;
  readonly rewardAmount: bigint;
  readonly dispatchIntervalSeconds: number;
  readonly nextDispatchAt?: Date;
  readonly operationalStatus: "DRAFT" | "READY" | "ACTIVE" | "PAUSED" | "STOPPED";
}

export interface RewardRun {
  readonly runId: string;
  readonly campaignId: string;
  readonly campaignName: string;
  readonly campaignPolicy: CampaignPolicy;
  readonly rewardAmount: bigint;
  readonly dispatchIntervalSeconds: number;
  readonly targetWalletCount: number;
  readonly processedCount: number;
  readonly confirmedCount: number;
  readonly alreadyRewardedCount: number;
  readonly skippedCount: number;
  readonly blockedCount: number;
  readonly reconciliationRequiredCount: number;
  readonly failedCount: number;
  readonly transactionsSent: number;
  readonly totalReward: bigint;
  readonly totalGas: bigint;
  readonly currentSequence: number;
  readonly status: RewardRunStatus;
  readonly createdAt: Date;
  readonly startedAt?: Date;
  readonly pausedAt?: Date;
  readonly resumedAt?: Date;
  readonly completedAt?: Date;
}

export interface RewardRunItem {
  readonly id: string;
  readonly runId: string;
  readonly sequence: number;
  readonly chainId: number;
  readonly walletId: string;
  readonly claimant: string;
  readonly campaignId: string;
  readonly campaignName: string;
  readonly policy: CampaignPolicy;
  readonly policyScope: string;
  readonly rewardAmount: bigint;
  readonly authorizationJobId?: string;
  readonly claimJobId?: string;
  readonly classification: RunItemClassification;
  readonly lifecycleState: RunItemLifecycleState;
  readonly transactionHash?: string;
  readonly rewardNonce?: bigint;
}

export type ProductionAction =
  | "CLAIM_CONFIRMED" | "SKIP_ALREADY_REWARDED" | "SKIP_ONCE_PER_CAMPAIGN"
  | "BLOCKED_INSUFFICIENT_GAS" | "BLOCKED_CAMPAIGN" | "BLOCKED_BUDGET"
  | "BLOCKED_INVENTORY" | "RECONCILIATION_REQUIRED" | "FAILED" | "SYSTEM_ERROR";

export interface WalletExecutionResult {
  readonly action: ProductionAction;
  readonly classification: Exclude<RunItemClassification, "PENDING" | "READY">;
  readonly transactionsSent: number;
  readonly authorizationJobId?: string;
  readonly claimJobId?: string;
  readonly transactionHash?: string;
  readonly blockNumber?: number;
  readonly rewardNonce?: bigint;
  readonly actualGasWei?: bigint;
  readonly blockerCode?: string;
  readonly errorCode?: string;
}

export interface Lease {
  readonly ownerId: string;
  readonly token: string;
  readonly expiresAt: Date;
}
