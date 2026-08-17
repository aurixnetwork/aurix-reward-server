import type { AuthorizationJobRecord } from "../authorization/authorization-types.js";
import type { BatchRunnerDependencies } from "../batch/batch-types.js";
import type { ClaimJobRecord } from "../claim/claim-types.js";
import type { ProductionClaimExecutor } from "./global-dispatcher.js";
import type { RewardRunItem, WalletExecutionResult } from "./production-types.js";

export function createProductionClaimExecutor(
  dependenciesFor: (item: RewardRunItem) => BatchRunnerDependencies,
): ProductionClaimExecutor {
  return {
    execute: (item) => executeExistingLifecycle(item, dependenciesFor(item)),
    reconcile: (item) => reconcileExistingLifecycle(item, dependenciesFor(item)),
  };
}

async function executeExistingLifecycle(
  item: RewardRunItem,
  dependencies: BatchRunnerDependencies,
): Promise<WalletExecutionResult> {
  const wallet = await dependencies.wallets.findPublicById(item.walletId);
  if (!wallet || wallet.status !== "ACTIVE" || wallet.walletAddress !== item.claimant) {
    return blocked("BLOCKED_CAMPAIGN", "BLOCKED_USER_WALLET_INVALID");
  }
  const unresolved = await dependencies.claimJobs.findUnresolvedByWalletCampaign(item.walletId, item.campaignId);
  if (unresolved) return reconciliation(unresolved);
  const latest = await dependencies.inspection.getBlock("latest");
  if (!latest) return systemError("LATEST_BLOCK_UNAVAILABLE");

  const active = await dependencies.authorizationJobs.listActiveByCampaignClaimant(item.campaignId, item.claimant);
  let authorization = active.find((job) =>
    job.status === "READY" && job.walletId === item.walletId && job.amount === item.rewardAmount &&
    BigInt(latest.timestamp) <= job.deadline,
  );
  if (!authorization) {
    try {
      authorization = await dependencies.lifecycle.createAuthorization(wallet, latest.timestamp);
    } catch (error: unknown) {
      const code = error instanceof Error && "code" in error && typeof error.code === "string"
        ? error.code : "AUTHORIZATION_FAILED";
      return mapBlocker(code);
    }
  }
  const existing = await dependencies.claimJobs.findByAuthorizationJobId(authorization.jobId);
  const plan = await dependencies.lifecycle.buildClaimPlan(authorization, wallet, existing);
  if (plan.expectedAction === "SKIP_ALREADY_CONFIRMED" && existing) return confirmed(authorization, existing);
  if (["RECONCILE_EXISTING", "RECONCILE_REWARD_ALREADY_USED"].includes(plan.expectedAction)) {
    return existing ? reconciliation(existing, authorization) : {
      action: "RECONCILIATION_REQUIRED", authorizationJobId: authorization.jobId,
      classification: "RECONCILIATION_REQUIRED", rewardNonce: authorization.rewardNonce, transactionsSent: 0,
    };
  }
  if (plan.expectedAction !== "SIGN_AND_BROADCAST" || plan.blockers.length > 0) {
    return mapBlocker(plan.blockers[0]?.code ?? "CLAIM_PLAN_BLOCKED", authorization);
  }
  const encrypted = await dependencies.wallets.findEncryptedById(item.walletId);
  if (!encrypted) return blocked("BLOCKED_CAMPAIGN", "BLOCKED_USER_WALLET_NOT_FOUND", authorization);
  const execution = await dependencies.lifecycle.executeClaim(authorization, plan, encrypted);
  const persisted = await dependencies.claimJobs.findByAuthorizationJobId(authorization.jobId);
  if (execution.status === "CONFIRMED" && persisted) return confirmed(authorization, persisted, execution.transactionsSent);
  if (execution.status === "PENDING_REVIEW") {
    return {
      action: "RECONCILIATION_REQUIRED", authorizationJobId: authorization.jobId,
      claimJobId: execution.claimJobId, classification: "RECONCILIATION_REQUIRED",
      rewardNonce: authorization.rewardNonce, transactionHash: execution.txHash,
      transactionsSent: execution.transactionsSent,
    };
  }
  return {
    action: "FAILED", authorizationJobId: authorization.jobId, claimJobId: execution.claimJobId,
    classification: "FAILED", errorCode: "CLAIM_FAILED", rewardNonce: authorization.rewardNonce,
    transactionHash: execution.txHash, transactionsSent: execution.transactionsSent,
  };
}

async function reconcileExistingLifecycle(
  item: RewardRunItem,
  dependencies: BatchRunnerDependencies,
): Promise<WalletExecutionResult> {
  await dependencies.lifecycle.reconcileClaims();
  const unresolved = await dependencies.claimJobs.findUnresolvedByWalletCampaign(item.walletId, item.campaignId);
  if (unresolved) return reconciliation(unresolved);
  const latest = await dependencies.claimJobs.findLatestByWalletCampaign?.(item.walletId, item.campaignId);
  if (latest?.status === "CONFIRMED") {
    const authorization = await dependencies.authorizationJobs.findByJobId?.(latest.authorizationJobId);
    if (authorization) return confirmed(authorization, latest);
  }
  const active = await dependencies.authorizationJobs.listActiveByCampaignClaimant(item.campaignId, item.claimant);
  for (const authorization of active) {
    const job = await dependencies.claimJobs.findByAuthorizationJobId(authorization.jobId);
    if (job?.status === "CONFIRMED") return confirmed(authorization, job);
    if (job) return reconciliation(job, authorization);
  }
  if (item.lifecycleState === "ACQUIRED" && !item.authorizationJobId && !item.claimJobId) {
    return executeExistingLifecycle(item, dependencies);
  }
  return {
    action: "RECONCILIATION_REQUIRED", classification: "RECONCILIATION_REQUIRED",
    errorCode: "RECOVERY_EVIDENCE_INCOMPLETE", transactionsSent: 0,
  };
}

function confirmed(
  authorization: AuthorizationJobRecord, job: ClaimJobRecord, transactionsSent: number = 0,
): WalletExecutionResult {
  return {
    action: "CLAIM_CONFIRMED", authorizationJobId: authorization.jobId, claimJobId: job.jobId,
    classification: "CONFIRMED", ...(job.blockNumber === undefined ? {} : { blockNumber: job.blockNumber }),
    ...(job.feePaidWei === undefined ? {} : { actualGasWei: job.feePaidWei }),
    rewardNonce: authorization.rewardNonce,
    transactionHash: job.broadcastTxHash ?? job.signedTxHash,
    transactionsSent,
  };
}

function reconciliation(job: ClaimJobRecord, authorization?: AuthorizationJobRecord): WalletExecutionResult {
  return {
    action: "RECONCILIATION_REQUIRED", ...(authorization ? { authorizationJobId: authorization.jobId } : {}),
    claimJobId: job.jobId, classification: "RECONCILIATION_REQUIRED", rewardNonce: job.rewardNonce,
    transactionHash: job.broadcastTxHash ?? job.signedTxHash, transactionsSent: 0,
  };
}

function mapBlocker(code: string, authorization?: AuthorizationJobRecord): WalletExecutionResult {
  if (code.includes("INSUFFICIENT_USER_GAS")) return blocked("BLOCKED_INSUFFICIENT_GAS", code, authorization);
  if (code.includes("BUDGET")) return blocked("BLOCKED_BUDGET", code, authorization);
  if (code.includes("REWARD_CONTRACT_IRB")) return blocked("BLOCKED_INVENTORY", code, authorization);
  return blocked("BLOCKED_CAMPAIGN", code, authorization);
}

function blocked(
  action: "BLOCKED_INSUFFICIENT_GAS" | "BLOCKED_CAMPAIGN" | "BLOCKED_BUDGET" | "BLOCKED_INVENTORY",
  code: string, authorization?: AuthorizationJobRecord,
): WalletExecutionResult {
  return { action, ...(authorization ? { authorizationJobId: authorization.jobId, rewardNonce: authorization.rewardNonce } : {}), blockerCode: code, classification: "BLOCKED", transactionsSent: 0 };
}

function systemError(code: string): WalletExecutionResult {
  return { action: "SYSTEM_ERROR", classification: "SYSTEM_ERROR", errorCode: code, transactionsSent: 0 };
}
