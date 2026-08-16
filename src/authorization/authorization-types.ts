import type { RewardCampaign, RewardClaimantState } from "../contracts/reward-contract-client.js";

export interface RewardAuthorization {
  readonly claimant: string;
  readonly amount: bigint;
  readonly campaignId: string;
  readonly rewardId: string;
  readonly rewardNonce: bigint;
  readonly validAfter: bigint;
  readonly deadline: bigint;
}

export type AuthorizationJobStatus =
  | "PLANNED"
  | "SIGNED"
  | "READY"
  | "CONSUMED"
  | "EXPIRED"
  | "CANCELLED"
  | "FAILED";

export interface AuthorizationJobRecord extends RewardAuthorization {
  readonly approverAddress: string;
  readonly approverSignature?: string;
  readonly expiredAt?: Date;
  readonly jobId: string;
  readonly status: AuthorizationJobStatus;
  readonly typedDataHash?: string;
  readonly walletId: string;
}

export interface CreatedAuthorizationJobRecord extends AuthorizationJobRecord {
  readonly reissuedFromAuthorizationJobId?: string;
}

export interface PlannedAuthorizationInput extends RewardAuthorization {
  readonly approverAddress: string;
  readonly jobId: string;
  readonly walletId: string;
}

export interface CampaignAuthorizationReader {
  getAuthorizationTypeHash(): Promise<string>;
  getCampaign(campaignId: string): Promise<RewardCampaign>;
  getClaimantState(campaignId: string, claimant: string): Promise<RewardClaimantState>;
  getRewardNonce(campaignId: string, claimant: string): Promise<bigint>;
  hasApproverRole(account: string): Promise<boolean>;
  isPaused(): Promise<boolean>;
  isRewardIdUsed(rewardId: string): Promise<boolean>;
}

export interface AuthorizationPreparation {
  readonly authorization: RewardAuthorization;
  readonly campaign: RewardCampaign;
  readonly claimantState: RewardClaimantState;
  readonly eligibility: RewardEligibilityDecision;
  readonly transactionsSent: 0;
}

export type AuthorizationBlockCode =
  | "BLOCKED_TEST_ELIGIBILITY_DENIED"
  | "BLOCKED_USER_WALLET_NOT_FOUND"
  | "BLOCKED_USER_WALLET_INACTIVE"
  | "BLOCKED_CONTRACT_PAUSED"
  | "BLOCKED_CAMPAIGN_NOT_FOUND"
  | "BLOCKED_CAMPAIGN_INACTIVE"
  | "BLOCKED_CAMPAIGN_NOT_STARTED"
  | "BLOCKED_CAMPAIGN_ENDED"
  | "BLOCKED_CLAIM_INTERVAL"
  | "BLOCKED_AMOUNT_EXCEEDS_MAX"
  | "BLOCKED_CAMPAIGN_BUDGET"
  | "BLOCKED_VALIDITY_EXCEEDS_CAMPAIGN";

export type AuthorizationPlanResult =
  | (AuthorizationPreparation & { readonly status: "READY_TO_AUTHORIZE" })
  | {
      readonly code: AuthorizationBlockCode;
      readonly reason: string;
      readonly status: "BLOCKED";
      readonly transactionsSent: 0;
    };

export type AuthorizationVerificationStatus =
  | "VALID"
  | "EXPIRED"
  | "STALE_NONCE"
  | "INVALID_HASH"
  | "INVALID_SIGNATURE"
  | "WRONG_APPROVER"
  | "APPROVER_ROLE_MISSING";

export interface AuthorizationVerificationResult {
  readonly currentRewardNonce: bigint;
  readonly expectedApprover: string;
  readonly jobId: string;
  readonly recoveredSigner?: string;
  readonly status: AuthorizationVerificationStatus;
  readonly transactionsSent: 0;
}

export interface RewardEligibilityInput {
  readonly amount: bigint;
  readonly campaignId: string;
  readonly claimant: string;
  readonly walletId: string;
}

export interface RewardEligibilityDecision {
  readonly eligible: boolean;
  readonly reason: string;
  readonly source: "TEST_ELIGIBILITY" | "PRODUCTION_ELIGIBILITY";
}

export interface RewardEligibilityService {
  evaluate(input: RewardEligibilityInput): Promise<RewardEligibilityDecision>;
}
