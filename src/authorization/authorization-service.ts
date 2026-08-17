import { id, ZeroHash } from "ethers";
import type { TypedDataDomain } from "ethers";

import {
  REWARD_AUTHORIZATION_TYPE_STRING,
} from "../config/constants.js";
import type { PublicWalletRecord } from "../wallets/wallet-types.js";
import {
  createAuthorizationWindow,
} from "./authorization-policy.js";
import {
  ActiveAuthorizationExistsError,
  AuthorizationReissueRequiresClaimReconciliationError,
  DuplicateAuthorizationError,
  type AuthorizationRepository,
} from "./authorization-repository.js";
import type {
  AuthorizationJobRecord,
  AuthorizationPlanResult,
  AuthorizationVerificationResult,
  CampaignAuthorizationReader,
  CreatedAuthorizationJobRecord,
  RewardAuthorization,
  RewardEligibilityService,
} from "./authorization-types.js";
import {
  hashRewardAuthorization,
  recoverRewardAuthorizationSigner,
  signRewardAuthorization,
  validateRewardAuthorization,
} from "./eip712.js";
import {
  createAuthorizationJobId,
  createRewardId,
} from "./reward-id.js";

export interface PlanAuthorizationInput {
  readonly amount: bigint;
  readonly campaignId: string;
  readonly eligibility: RewardEligibilityService;
  readonly nowSeconds: number;
  readonly reader: CampaignAuthorizationReader;
  readonly rewardId: string;
  readonly validitySeconds: number;
  readonly wallet: PublicWalletRecord;
}

export interface CreateAuthorizationInput {
  readonly amount: bigint;
  readonly approverAddress: string;
  readonly approverPrivateKey: string;
  readonly campaignId: string;
  readonly clock?: () => number;
  readonly eligibility: RewardEligibilityService;
  readonly eip712Domain?: TypedDataDomain;
  readonly entropy?: string;
  readonly jobId?: string;
  readonly nowSeconds: number;
  readonly reader: CampaignAuthorizationReader;
  readonly repository: AuthorizationRepository;
  readonly validitySeconds: number;
  readonly wallet: PublicWalletRecord;
}

export class AuthorizationBlockedError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AuthorizationBlockedError";
  }
}

export async function planRewardAuthorization(
  input: PlanAuthorizationInput,
): Promise<AuthorizationPlanResult> {
  if (input.amount <= 0n) throw new Error("Authorization amount must be greater than zero");
  const eligibility = await input.eligibility.evaluate({
    amount: input.amount,
    campaignId: input.campaignId,
    claimant: input.wallet.walletAddress,
    walletId: input.wallet.id,
  });
  if (!eligibility.eligible) {
    return blocked("BLOCKED_TEST_ELIGIBILITY_DENIED", eligibility.reason);
  }
  if (input.wallet.status !== "ACTIVE") {
    return blocked("BLOCKED_USER_WALLET_INACTIVE", "User Wallet is not ACTIVE");
  }
  if (await input.reader.isPaused()) {
    return blocked("BLOCKED_CONTRACT_PAUSED", "AurixRewardClaim is paused");
  }

  const campaign = await input.reader.getCampaign(input.campaignId);
  if (!campaign.exists) {
    return blocked("BLOCKED_CAMPAIGN_NOT_FOUND", "Campaign does not exist on AurixRewardClaim");
  }
  if (!campaign.active) {
    return blocked("BLOCKED_CAMPAIGN_INACTIVE", "Campaign is not active");
  }
  const now = BigInt(input.nowSeconds);
  if (now < campaign.startTime) {
    return blocked("BLOCKED_CAMPAIGN_NOT_STARTED", "Campaign has not started");
  }
  if (now >= campaign.endTime) {
    return blocked("BLOCKED_CAMPAIGN_ENDED", "Campaign has ended");
  }
  if (input.amount > campaign.maxRewardAmount) {
    return blocked("BLOCKED_AMOUNT_EXCEEDS_MAX", "Amount exceeds campaign maxRewardAmount");
  }
  if (campaign.distributed + input.amount > campaign.budget) {
    return blocked("BLOCKED_CAMPAIGN_BUDGET", "Campaign remaining budget is insufficient");
  }

  const claimantState = await input.reader.getClaimantState(
    input.campaignId,
    input.wallet.walletAddress,
  );
  if (!claimantState.claimIntervalElapsed || claimantState.nextClaimAt > now) {
    return blocked("BLOCKED_CLAIM_INTERVAL", "Claimant campaign interval has not elapsed");
  }
  const window = createAuthorizationWindow(input.nowSeconds, input.validitySeconds);
  if (window.deadline > campaign.endTime) {
    return blocked(
      "BLOCKED_VALIDITY_EXCEEDS_CAMPAIGN",
      "Configured authorization validity extends beyond campaign end",
    );
  }
  const authorization: RewardAuthorization = {
    amount: input.amount,
    campaignId: input.campaignId,
    claimant: input.wallet.walletAddress,
    deadline: window.deadline,
    rewardId: input.rewardId,
    rewardNonce: claimantState.rewardNonce,
    validAfter: window.validAfter,
  };
  validateRewardAuthorization(authorization, now);
  return {
    authorization,
    campaign,
    claimantState,
    eligibility,
    status: "READY_TO_AUTHORIZE",
    transactionsSent: 0,
  };
}

export async function createAndSignRewardAuthorization(
  input: CreateAuthorizationInput,
): Promise<CreatedAuthorizationJobRecord> {
  const jobId = input.jobId ?? createAuthorizationJobId();
  const plan = await planRewardAuthorization({
    amount: input.amount,
    campaignId: input.campaignId,
    eligibility: input.eligibility,
    nowSeconds: input.nowSeconds,
    reader: input.reader,
    rewardId: ZeroHash,
    validitySeconds: input.validitySeconds,
    wallet: input.wallet,
  });
  if (plan.status === "BLOCKED") {
    throw new AuthorizationBlockedError(plan.code, plan.reason);
  }
  const currentNonce = await input.reader.getRewardNonce(
    input.campaignId,
    input.wallet.walletAddress,
  );
  if (plan.authorization.rewardNonce !== currentNonce) {
    throw new AuthorizationBlockedError(
      "REWARD_NONCE_CHANGED_DURING_PREPARATION",
      "Contract rewardNonce changed during authorization preparation",
    );
  }
  const rewardId = createRewardId({
    campaignId: input.campaignId,
    claimant: input.wallet.walletAddress,
    jobId,
    rewardNonce: currentNonce,
  }, input.entropy);
  if (await input.reader.isRewardIdUsed(rewardId)) {
    throw new AuthorizationBlockedError(
      "REWARD_ID_ALREADY_USED_ON_CHAIN",
      "Generated rewardId is already used on the Reward Contract",
    );
  }
  const authorization = { ...plan.authorization, rewardId };
  let reissuedFromAuthorizationJobId: string | undefined;
  try {
    const reservation = await input.repository.reservePlanned(
      {
        ...authorization,
        approverAddress: input.approverAddress,
        jobId,
        walletId: input.wallet.id,
      },
      BigInt(input.nowSeconds),
      async (expired) => {
        const [lockedRewardNonce, oldRewardIdUsed] = await Promise.all([
          input.reader.getRewardNonce(expired.campaignId, expired.claimant),
          input.reader.isRewardIdUsed(expired.rewardId),
        ]);
        if (lockedRewardNonce !== expired.rewardNonce) {
          throw new AuthorizationBlockedError(
            "AUTHORIZATION_REISSUE_REWARD_NONCE_ADVANCED",
            "Contract rewardNonce advanced before the expired authorization could be retired",
          );
        }
        if (oldRewardIdUsed) {
          throw new AuthorizationBlockedError(
            "AUTHORIZATION_REISSUE_REWARD_ID_USED",
            "Expired authorization rewardId is already used and requires reconciliation",
          );
        }
      },
    );
    reissuedFromAuthorizationJobId = reservation.expiredAuthorizationJobId;
  } catch (error: unknown) {
    if (error instanceof ActiveAuthorizationExistsError) {
      throw new AuthorizationBlockedError(
        "ACTIVE_AUTHORIZATION_EXISTS",
        "A still-valid active authorization already exists for this contract rewardNonce",
      );
    }
    if (error instanceof AuthorizationReissueRequiresClaimReconciliationError) {
      throw new AuthorizationBlockedError(
        "AUTHORIZATION_REISSUE_REQUIRES_CLAIM_RECONCILIATION",
        "Expired authorization has an unresolved claim job that must be reconciled first",
      );
    }
    if (error instanceof DuplicateAuthorizationError) {
      throw new AuthorizationBlockedError(
        "ACTIVE_AUTHORIZATION_CONCURRENCY_CONFLICT",
        "Another worker reserved an active authorization for this contract rewardNonce",
      );
    }
    throw error;
  }

  try {
    const onChainTypeHash = await input.reader.getAuthorizationTypeHash();
    if (onChainTypeHash.toLowerCase() !== id(REWARD_AUTHORIZATION_TYPE_STRING).toLowerCase()) {
      throw new Error("Deployed RewardAuthorization type hash does not match the server definition");
    }
    const typedDataHash = hashRewardAuthorization(authorization, input.eip712Domain);
    validateRewardAuthorization(
      authorization,
      BigInt(input.clock?.() ?? input.nowSeconds),
    );
    const signature = await signRewardAuthorization(
      authorization,
      input.approverPrivateKey,
      input.eip712Domain,
    );
    const recovered = recoverRewardAuthorizationSigner(authorization, signature, input.eip712Domain);
    if (recovered !== input.approverAddress) {
      throw new Error("Recovered authorization signer does not match expected Approver");
    }
    if (!await input.reader.hasApproverRole(recovered)) {
      throw new Error("Expected Approver does not currently have APPROVER_ROLE");
    }
    await input.repository.markReady(jobId, typedDataHash, signature);
    return {
      ...authorization,
      approverAddress: input.approverAddress,
      approverSignature: signature,
      jobId,
      ...(reissuedFromAuthorizationJobId ? { reissuedFromAuthorizationJobId } : {}),
      status: "READY",
      typedDataHash,
      walletId: input.wallet.id,
    };
  } catch (error: unknown) {
    await input.repository.markFailed(
      jobId,
      "AUTHORIZATION_SIGNING_FAILED",
      "Authorization signing or Approver verification failed",
    );
    throw error;
  }
}

export async function verifyPersistedAuthorization(
  job: AuthorizationJobRecord,
  reader: CampaignAuthorizationReader,
  expectedApprover: string,
  nowSeconds: number,
  eip712Domain?: TypedDataDomain,
): Promise<AuthorizationVerificationResult> {
  const currentRewardNonce = await reader.getRewardNonce(
    job.campaignId,
    job.claimant,
  );
  const base = {
    currentRewardNonce,
    expectedApprover,
    jobId: job.jobId,
    transactionsSent: 0 as const,
  };
  const authorization = authorizationFromJob(job);
  const onChainTypeHash = await reader.getAuthorizationTypeHash();
  if (onChainTypeHash.toLowerCase() !== id(REWARD_AUTHORIZATION_TYPE_STRING).toLowerCase()) {
    return { ...base, status: "INVALID_HASH" };
  }
  let calculatedHash: string;
  try {
    validateRewardAuthorization(authorization);
    calculatedHash = hashRewardAuthorization(authorization, eip712Domain);
  } catch {
    return { ...base, status: "INVALID_HASH" };
  }
  if (!job.typedDataHash || calculatedHash.toLowerCase() !== job.typedDataHash.toLowerCase()) {
    return { ...base, status: "INVALID_HASH" };
  }
  if (!job.approverSignature) return { ...base, status: "INVALID_SIGNATURE" };
  let recoveredSigner: string;
  try {
    recoveredSigner = recoverRewardAuthorizationSigner(
      authorization,
      job.approverSignature,
      eip712Domain,
    );
  } catch {
    return { ...base, status: "INVALID_SIGNATURE" };
  }
  if (recoveredSigner !== expectedApprover || job.approverAddress !== expectedApprover) {
    return { ...base, recoveredSigner, status: "WRONG_APPROVER" };
  }
  if (!await reader.hasApproverRole(expectedApprover)) {
    return { ...base, recoveredSigner, status: "APPROVER_ROLE_MISSING" };
  }
  if (job.deadline < BigInt(nowSeconds)) {
    return { ...base, recoveredSigner, status: "EXPIRED" };
  }
  if (currentRewardNonce !== job.rewardNonce) {
    return { ...base, recoveredSigner, status: "STALE_NONCE" };
  }
  return { ...base, recoveredSigner, status: "VALID" };
}

function authorizationFromJob(job: AuthorizationJobRecord): RewardAuthorization {
  return {
    amount: job.amount,
    campaignId: job.campaignId,
    claimant: job.claimant,
    deadline: job.deadline,
    rewardId: job.rewardId,
    rewardNonce: job.rewardNonce,
    validAfter: job.validAfter,
  };
}

function blocked(
  code: Extract<AuthorizationPlanResult, { status: "BLOCKED" }>["code"],
  reason: string,
): AuthorizationPlanResult {
  return { code, reason, status: "BLOCKED", transactionsSent: 0 };
}
