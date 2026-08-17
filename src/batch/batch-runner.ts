import { randomUUID } from "node:crypto";

import { AuthorizationBlockedError } from "../authorization/authorization-service.js";
import { ClaimExecutionError } from "../claim/claim-execution-error.js";
import { ClaimPersistenceError } from "../claim/claim-persistence-error.js";
import type { AuthorizationJobRecord } from "../authorization/authorization-types.js";
import type { ClaimExecutionResult } from "../claim/claim-service.js";
import type { ClaimBlocker, ClaimJobRecord, ClaimPlan } from "../claim/claim-types.js";
import type { PublicWalletRecord } from "../wallets/wallet-types.js";

import type {
  BatchCommandArgs,
  BatchItemClassification,
  BatchRunResult,
  BatchRunnerDependencies,
  BatchSafeError,
  BatchWalletItem,
  PreparedBatchWallet,
} from "./batch-types.js";

const MINIMUM_TRANSACTION_GAS = 21_000n;

export async function runBatchPlan(
  args: BatchCommandArgs,
  dependencies: BatchRunnerDependencies,
): Promise<BatchRunResult> {
  return runBatch("PLAN", args, dependencies, false);
}

export async function runBatchExecution(
  args: BatchCommandArgs,
  dependencies: BatchRunnerDependencies,
  executionEnabled: boolean,
): Promise<BatchRunResult> {
  if (!executionEnabled) {
    throw new ClaimExecutionError("CLAIM_EXECUTION_DISABLED");
  }
  return runBatch("EXECUTE", args, dependencies, true);
}

async function runBatch(
  mode: "PLAN" | "EXECUTE",
  args: BatchCommandArgs,
  dependencies: BatchRunnerDependencies,
  executionEnabled: boolean,
): Promise<BatchRunResult> {
  const batchRunId = randomUUID();
  const startedAt = new Date().toISOString();
  const items: BatchWalletItem[] = [];
  let status: BatchRunResult["status"] = "COMPLETED";
  let systemError: BatchSafeError | undefined;

  if (executionEnabled) {
    try {
      await dependencies.lifecycle.reconcileClaims();
    } catch (error: unknown) {
      status = "ABORTED_SYSTEM_ERROR";
      systemError = safeBatchError(error);
    }
  }

  if (!systemError) {
    for (let walletId = args.walletIdStart; walletId <= args.walletIdEnd; walletId += 1) {
      let prepared: PreparedBatchWallet;
      try {
        prepared = await prepareBatchWallet(String(walletId), args, dependencies);
      } catch (error: unknown) {
        const safeError = safeBatchError(error);
        items.push(systemErrorItem(String(walletId), safeError));
        status = "ABORTED_SYSTEM_ERROR";
        systemError = safeError;
        break;
      }

      if (!executionEnabled || prepared.item.classification !== "READY") {
        items.push(prepared.item);
        continue;
      }

      try {
        const executed = await executePreparedWallet(prepared, dependencies);
        items.push(executed);
        if (executed.action === "CLAIM_PENDING_REVIEW") {
          status = "ABORTED_UNCERTAIN_CLAIM";
          break;
        }
        if (executed.action === "CLAIM_FAILED") {
          status = "ABORTED_SYSTEM_ERROR";
          break;
        }
      } catch (error: unknown) {
        if (error instanceof AuthorizationBlockedError) {
          items.push(authorizationBlockedItem(
            prepared.item.walletId,
            prepared.item.claimant,
            error.code,
          ));
          continue;
        }
        const safeError = safeBatchError(error);
        items.push(systemErrorItem(
          prepared.item.walletId,
          safeError,
          prepared.item.claimant,
        ));
        status = "ABORTED_SYSTEM_ERROR";
        systemError = safeError;
        break;
      }
    }
  }

  return summarize({
    args,
    batchRunId,
    items,
    mode,
    startedAt,
    status,
    ...(systemError ? { systemError } : {}),
  });
}

async function prepareBatchWallet(
  walletId: string,
  args: BatchCommandArgs,
  dependencies: BatchRunnerDependencies,
): Promise<PreparedBatchWallet> {
  const wallet = await dependencies.wallets.findPublicById(walletId);
  if (!wallet) {
    return {
      item: expectedBlockerItem(
        walletId,
        undefined,
        "BLOCKED_USER_WALLET_NOT_FOUND",
        "User Wallet was not found",
      ),
    };
  }
  if (wallet.status !== "ACTIVE") {
    return {
      item: expectedBlockerItem(
        walletId,
        wallet.walletAddress,
        "BLOCKED_USER_WALLET_INACTIVE",
        "User Wallet is not ACTIVE",
      ),
      publicWallet: wallet,
    };
  }

  const unresolved = await dependencies.claimJobs.findUnresolvedByWalletCampaign(
    walletId,
    args.campaignId,
  );
  if (unresolved) {
    return {
      item: reconciliationItem(wallet, unresolved),
      publicWallet: wallet,
    };
  }

  const latestBlock = await dependencies.inspection.getBlock("latest");
  if (!latestBlock) throw new Error("Latest block unavailable");
  const [authorizationPlan, activeAuthorizations] = await Promise.all([
    dependencies.lifecycle.planAuthorization(wallet, latestBlock.timestamp),
    dependencies.authorizationJobs.listActiveByCampaignClaimant(
      args.campaignId,
      wallet.walletAddress,
    ),
  ]);
  const observedRewardNonce = activeAuthorizations.length > 0
    ? await dependencies.lifecycle.getRewardNonce(args.campaignId, wallet.walletAddress)
    : undefined;
  const stale = observedRewardNonce === undefined
    ? undefined
    : activeAuthorizations.find((job) => job.rewardNonce !== observedRewardNonce);
  if (stale) {
    return {
      item: {
        action: "AUTHORIZATION_STALE_REQUIRES_RECONCILIATION",
        authorizationJobId: stale.jobId,
        blockers: [{
          code: "BLOCKED_STALE_REWARD_NONCE",
          reason: "An active authorization has a different contract rewardNonce",
        }],
        claimant: wallet.walletAddress,
        classification: "RECONCILIATION_REQUIRED",
        rewardNonce: observedRewardNonce ?? stale.rewardNonce,
        transactionsSent: 0,
        walletId,
      },
      publicWallet: wallet,
    };
  }
  if (authorizationPlan.status === "BLOCKED") {
    const reusable = activeAuthorizations.find((job) =>
      job.rewardNonce === observedRewardNonce &&
      job.status === "READY" &&
      job.amount === args.amount &&
      job.walletId === walletId &&
      job.claimant === wallet.walletAddress &&
      BigInt(latestBlock.timestamp) <= job.deadline,
    );
    if (authorizationPlan.code === "BLOCKED_VALIDITY_EXCEEDS_CAMPAIGN" && reusable) {
      const existingJob = await dependencies.claimJobs.findByAuthorizationJobId(
        reusable.jobId,
      );
      const claimPlan = await dependencies.lifecycle.buildClaimPlan(
        reusable,
        wallet,
        existingJob,
      );
      return {
        authorization: reusable,
        claimPlan,
        item: claimPlanItem(wallet, claimPlan, existingJob),
        publicWallet: wallet,
      };
    }
    return {
      item: expectedBlockerItem(
        walletId,
        wallet.walletAddress,
        authorizationPlan.code,
        authorizationPlan.reason,
        authorizationPlan.code === "BLOCKED_CLAIM_INTERVAL" ? "SKIPPED" : "EXPECTED_BLOCKER",
      ),
      publicWallet: wallet,
    };
  }

  const currentNonce = authorizationPlan.authorization.rewardNonce;
  const active = activeAuthorizations.find((job) => job.rewardNonce === currentNonce);
  if (active) {
    if (BigInt(latestBlock.timestamp) > active.deadline) {
      if (await dependencies.lifecycle.isRewardIdUsed(active.rewardId)) {
        return {
          item: {
            action: "REWARD_ALREADY_USED_REQUIRES_RECONCILIATION",
            authorizationJobId: active.jobId,
            blockers: [{
              code: "BLOCKED_REWARD_ID_USED",
              reason: "Expired authorization rewardId is already used on-chain",
            }],
            claimant: wallet.walletAddress,
            classification: "RECONCILIATION_REQUIRED",
            rewardNonce: currentNonce,
            transactionsSent: 0,
            walletId,
          },
          publicWallet: wallet,
        };
      }
      return prepareAuthorizationRequired(
        wallet,
        args,
        dependencies,
        authorizationPlan,
        active.jobId,
      );
    }
    if (active.status !== "READY") {
      return {
        item: expectedBlockerItem(
          walletId,
          wallet.walletAddress,
          "BLOCKED_AUTHORIZATION_NOT_READY",
          "The active authorization has not reached READY",
        ),
        publicWallet: wallet,
      };
    }
    if (
      active.amount !== args.amount ||
      active.walletId !== walletId ||
      active.claimant !== wallet.walletAddress
    ) {
      return {
        item: expectedBlockerItem(
          walletId,
          wallet.walletAddress,
          "BLOCKED_ACTIVE_AUTHORIZATION_MISMATCH",
          "A valid active authorization does not match this batch request",
        ),
        publicWallet: wallet,
      };
    }

    const existingJob = await dependencies.claimJobs.findByAuthorizationJobId(active.jobId);
    const claimPlan = await dependencies.lifecycle.buildClaimPlan(
      active,
      wallet,
      existingJob,
    );
    const item = claimPlanItem(wallet, claimPlan, existingJob);
    return {
      authorization: active,
      claimPlan,
      item,
      publicWallet: wallet,
    };
  }

  return prepareAuthorizationRequired(
    wallet,
    args,
    dependencies,
    authorizationPlan,
  );
}

async function prepareAuthorizationRequired(
  wallet: PublicWalletRecord,
  args: BatchCommandArgs,
  dependencies: BatchRunnerDependencies,
  authorizationPlan: Extract<
    Awaited<ReturnType<BatchRunnerDependencies["lifecycle"]["planAuthorization"]>>,
    { readonly status: "READY_TO_AUTHORIZE" }
  >,
  reissuedFromAuthorizationJobId?: string,
): Promise<PreparedBatchWallet> {
  const [userGasBalanceWei, irbBalance, rewardContractIrbBalance, feeData] =
    await Promise.all([
      dependencies.inspection.getBalance(wallet.walletAddress),
      dependencies.inspection.getIrbBalance(wallet.walletAddress),
      dependencies.inspection.getRewardContractIrbBalance(),
      dependencies.inspection.getFeeData(),
    ]);
  const common = {
    campaignRemainingBudget:
      authorizationPlan.campaign.budget - authorizationPlan.campaign.distributed,
    claimant: wallet.walletAddress,
    irbBalance,
    nextClaimAt: authorizationPlan.claimantState.nextClaimAt,
    rewardContractIrbBalance,
    rewardNonce: authorizationPlan.claimantState.rewardNonce,
    transactionsSent: 0,
    userGasBalanceWei,
    walletId: wallet.id,
  } as const;

  if (rewardContractIrbBalance < args.amount) {
    return {
      item: {
        ...common,
        action: "BLOCKED_REWARD_CONTRACT_IRB",
        blockers: [{
          code: "BLOCKED_REWARD_CONTRACT_IRB",
          reason: "Reward Contract IRB balance is insufficient",
        }],
        classification: "EXPECTED_BLOCKER",
      },
      publicWallet: wallet,
    };
  }
  const gasPriceWei = feeData.gasPrice;
  if (gasPriceWei === null || gasPriceWei <= 0n) {
    return {
      item: {
        ...common,
        action: "BLOCKED_GAS_PRICE_UNAVAILABLE",
        blockers: [{
          code: "BLOCKED_GAS_PRICE_UNAVAILABLE",
          reason: "RPC did not provide a positive legacy gas price",
        }],
        classification: "EXPECTED_BLOCKER",
      },
      publicWallet: wallet,
    };
  }
  if (
    dependencies.maxGasPriceWei !== undefined &&
    gasPriceWei > dependencies.maxGasPriceWei
  ) {
    return {
      item: {
        ...common,
        action: "BLOCKED_GAS_PRICE_LIMIT",
        blockers: [{
          code: "BLOCKED_GAS_PRICE_LIMIT",
          reason: "Observed gas price exceeds MAX_CLAIM_GAS_PRICE_GWEI",
        }],
        classification: "EXPECTED_BLOCKER",
      },
      publicWallet: wallet,
    };
  }
  if (userGasBalanceWei < MINIMUM_TRANSACTION_GAS * gasPriceWei) {
    return {
      item: {
        ...common,
        action: "BLOCKED_INSUFFICIENT_USER_GAS",
        blockers: [{
          code: "BLOCKED_INSUFFICIENT_USER_GAS",
          reason: "User Wallet cannot cover even the minimum transaction gas; no funding was attempted",
        }],
        classification: "EXPECTED_BLOCKER",
      },
      publicWallet: wallet,
    };
  }

  return {
    item: {
      ...common,
      action: "AUTHORIZATION_REQUIRED",
      ...(reissuedFromAuthorizationJobId
        ? { authorizationJobId: reissuedFromAuthorizationJobId }
        : {}),
      blockers: [],
      classification: "READY",
    },
    publicWallet: wallet,
  };
}

async function executePreparedWallet(
  prepared: PreparedBatchWallet,
  dependencies: BatchRunnerDependencies,
): Promise<BatchWalletItem> {
  const publicWallet = prepared.publicWallet;
  if (!publicWallet) throw new ClaimExecutionError("CLAIM_WALLET_INVALID");
  let authorization = prepared.authorization;
  let claimPlan = prepared.claimPlan;
  if (!authorization) {
    const latestBlock = await dependencies.inspection.getBlock("latest");
    if (!latestBlock) throw new Error("Latest block unavailable");
    authorization = await dependencies.lifecycle.createAuthorization(
      publicWallet,
      latestBlock.timestamp,
    );
    const existingJob = await dependencies.claimJobs.findByAuthorizationJobId(
      authorization.jobId,
    );
    claimPlan = await dependencies.lifecycle.buildClaimPlan(
      authorization,
      publicWallet,
      existingJob,
    );
    if (claimPlan.expectedAction !== "SIGN_AND_BROADCAST" || claimPlan.blockers.length > 0) {
      return claimPlanItem(publicWallet, claimPlan, existingJob);
    }
  }
  if (!claimPlan) throw new ClaimExecutionError("CLAIM_PLAN_NOT_EXECUTABLE");

  const encryptedWallet = prepared.encryptedWallet ??
    await dependencies.wallets.findEncryptedById(publicWallet.id);
  if (!encryptedWallet) throw new ClaimExecutionError("CLAIM_WALLET_INVALID");
  const result = await dependencies.lifecycle.executeClaim(
    authorization,
    claimPlan,
    encryptedWallet,
  );
  const persisted = await dependencies.claimJobs.findByAuthorizationJobId(
    authorization.jobId,
  );
  return executionItem(publicWallet, authorization, claimPlan, result, persisted);
}

function claimPlanItem(
  wallet: PublicWalletRecord,
  plan: ClaimPlan,
  existingJob?: ClaimJobRecord,
): BatchWalletItem {
  const base = {
    authorizationJobId: plan.authorization.jobId,
    blockers: plan.blockers,
    ...(plan.campaign
      ? { campaignRemainingBudget: plan.campaign.budget - plan.campaign.distributed }
      : {}),
    claimant: wallet.walletAddress,
    ...(plan.estimatedFeeWei === undefined
      ? {}
      : { estimatedFeeWei: plan.estimatedFeeWei }),
    irbBalance: plan.irbBalance,
    ...(plan.claimantState
      ? { nextClaimAt: plan.claimantState.nextClaimAt }
      : {}),
    rewardContractIrbBalance: plan.rewardContractIrbBalance,
    rewardNonce: plan.claimantState?.rewardNonce ?? plan.authorization.rewardNonce,
    transactionsSent: 0,
    userGasBalanceWei: plan.userGasBalanceWei,
    walletId: wallet.id,
  } as const;
  if (plan.expectedAction === "SIGN_AND_BROADCAST" && plan.blockers.length === 0) {
    return { ...base, action: "CLAIM_READY", classification: "READY" };
  }
  if (plan.expectedAction === "SKIP_ALREADY_CONFIRMED") {
    return {
      ...base,
      action: "SKIP_ALREADY_CONFIRMED",
      ...(existingJob ? { claimJobId: existingJob.jobId } : {}),
      classification: "SKIPPED",
    };
  }
  if (
    plan.expectedAction === "RECONCILE_EXISTING" ||
    plan.expectedAction === "RECONCILE_REWARD_ALREADY_USED"
  ) {
    return {
      ...base,
      action: plan.expectedAction === "RECONCILE_EXISTING"
        ? "UNRESOLVED_CLAIM_REQUIRES_RECONCILIATION"
        : "REWARD_ALREADY_USED_REQUIRES_RECONCILIATION",
      ...(existingJob ? { claimJobId: existingJob.jobId } : {}),
      classification: "RECONCILIATION_REQUIRED",
    };
  }
  const primary = primaryBlocker(plan.blockers);
  return {
    ...base,
    action: primary?.code ?? "BLOCKED_CLAIM_PLAN",
    classification: primary?.code === "BLOCKED_CLAIM_INTERVAL"
      ? "SKIPPED"
      : "EXPECTED_BLOCKER",
  };
}

function executionItem(
  wallet: PublicWalletRecord,
  authorization: AuthorizationJobRecord,
  plan: ClaimPlan,
  result: ClaimExecutionResult,
  persisted?: ClaimJobRecord,
): BatchWalletItem {
  const action = result.status === "CONFIRMED"
    ? "CLAIM_CONFIRMED"
    : result.status === "PENDING_REVIEW"
      ? "CLAIM_PENDING_REVIEW"
      : "CLAIM_FAILED";
  const classification: BatchItemClassification = result.status === "CONFIRMED"
    ? "CONFIRMED"
    : "FAILED";
  return {
    action,
    ...(persisted?.feePaidWei === undefined ? {} : { actualFeeWei: persisted.feePaidWei }),
    authorizationJobId: authorization.jobId,
    blockers: [],
    ...(plan.campaign
      ? { campaignRemainingBudget: plan.campaign.budget - plan.campaign.distributed }
      : {}),
    claimJobId: result.claimJobId,
    claimant: wallet.walletAddress,
    classification,
    ...(plan.estimatedFeeWei === undefined
      ? {}
      : { estimatedFeeWei: plan.estimatedFeeWei }),
    irbBalance: plan.irbBalance,
    ...(plan.claimantState
      ? { nextClaimAt: plan.claimantState.nextClaimAt }
      : {}),
    rewardContractIrbBalance: plan.rewardContractIrbBalance,
    rewardNonce: authorization.rewardNonce,
    transactionHash: result.txHash,
    transactionsSent: result.transactionsSent,
    userGasBalanceWei: plan.userGasBalanceWei,
    walletId: wallet.id,
  };
}

function reconciliationItem(
  wallet: PublicWalletRecord,
  job: ClaimJobRecord,
): BatchWalletItem {
  return {
    action: "UNRESOLVED_CLAIM_REQUIRES_RECONCILIATION",
    authorizationJobId: job.authorizationJobId,
    blockers: [{
      code: "BLOCKED_EXISTING_CLAIM_JOB",
      reason: "SIGNED, BROADCAST, or PENDING_REVIEW claim evidence remains unresolved",
    }],
    claimJobId: job.jobId,
    claimant: wallet.walletAddress,
    classification: "RECONCILIATION_REQUIRED",
    rewardNonce: job.rewardNonce,
    transactionHash: job.broadcastTxHash ?? job.signedTxHash,
    transactionsSent: 0,
    walletId: wallet.id,
  };
}

function expectedBlockerItem(
  walletId: string,
  claimant: string | undefined,
  code: string,
  reason: string,
  classification: "EXPECTED_BLOCKER" | "SKIPPED" = "EXPECTED_BLOCKER",
): BatchWalletItem {
  return {
    action: code,
    blockers: [{ code, reason }],
    ...(claimant ? { claimant } : {}),
    classification,
    transactionsSent: 0,
    walletId,
  };
}

function authorizationBlockedItem(
  walletId: string,
  claimant: string | undefined,
  code: string,
): BatchWalletItem {
  const requiresReconciliation = [
    "AUTHORIZATION_REISSUE_REQUIRES_CLAIM_RECONCILIATION",
    "AUTHORIZATION_REISSUE_REWARD_NONCE_ADVANCED",
    "AUTHORIZATION_REISSUE_REWARD_ID_USED",
  ].includes(code);
  return {
    action: requiresReconciliation
      ? "AUTHORIZATION_STALE_REQUIRES_RECONCILIATION"
      : code,
    blockers: [{
      code,
      reason: requiresReconciliation
        ? "Authorization lifecycle requires reconciliation before another claim"
        : "Authorization lifecycle blocked this wallet",
    }],
    ...(claimant ? { claimant } : {}),
    classification: requiresReconciliation
      ? "RECONCILIATION_REQUIRED"
      : "EXPECTED_BLOCKER",
    transactionsSent: 0,
    walletId,
  };
}

function systemErrorItem(
  walletId: string,
  safeError: BatchSafeError,
  claimant?: string,
): BatchWalletItem {
  return {
    action: "SYSTEM_ERROR",
    blockers: [],
    ...(claimant ? { claimant } : {}),
    classification: "SYSTEM_ERROR",
    safeError,
    transactionsSent: 0,
    walletId,
  };
}

function safeBatchError(error: unknown): BatchSafeError {
  if (error instanceof ClaimPersistenceError) {
    return { code: error.code, stage: error.stage, type: error.type };
  }
  if (error instanceof ClaimExecutionError) {
    return { code: error.code, type: error.name };
  }
  if (error instanceof AuthorizationBlockedError) {
    return { code: error.code, type: error.name };
  }
  return {
    code: "BATCH_SYSTEM_ERROR",
    type: error instanceof Error ? error.name : "UnknownError",
  };
}

function primaryBlocker(blockers: readonly ClaimBlocker[]): ClaimBlocker | undefined {
  const priority = [
    "BLOCKED_CLAIM_INTERVAL",
    "BLOCKED_CAMPAIGN_NOT_FOUND",
    "BLOCKED_CAMPAIGN_INACTIVE",
    "BLOCKED_CAMPAIGN_NOT_STARTED",
    "BLOCKED_CAMPAIGN_ENDED",
    "BLOCKED_CAMPAIGN_BUDGET",
    "BLOCKED_REWARD_CONTRACT_IRB",
    "BLOCKED_INSUFFICIENT_USER_GAS",
  ];
  return priority
    .map((code) => blockers.find((blocker) => blocker.code === code))
    .find((blocker) => blocker !== undefined) ?? blockers[0];
}

function summarize(input: {
  readonly args: BatchCommandArgs;
  readonly batchRunId: string;
  readonly items: readonly BatchWalletItem[];
  readonly mode: "PLAN" | "EXECUTE";
  readonly startedAt: string;
  readonly status: BatchRunResult["status"];
  readonly systemError?: BatchSafeError;
}): BatchRunResult {
  const count = (classification: BatchItemClassification) =>
    input.items.filter((item) => item.classification === classification).length;
  return {
    actualGasWei: input.items.reduce((total, item) => total + (item.actualFeeWei ?? 0n), 0n),
    batchRunId: input.batchRunId,
    blocked: count("EXPECTED_BLOCKER"),
    campaignId: input.args.campaignId,
    completedAt: new Date().toISOString(),
    concurrency: 1,
    confirmed: count("CONFIRMED"),
    estimatedGasWei: input.items.reduce((total, item) => total + (item.estimatedFeeWei ?? 0n), 0n),
    failed: count("FAILED") + count("SYSTEM_ERROR") +
      (input.systemError && count("SYSTEM_ERROR") === 0 ? 1 : 0),
    items: input.items,
    mode: input.mode,
    processed: input.items.length,
    reconciliationRequired: count("RECONCILIATION_REQUIRED"),
    requestedWallets: input.args.walletIdEnd - input.args.walletIdStart + 1,
    skipped: count("SKIPPED"),
    startedAt: input.startedAt,
    status: input.status,
    ...(input.systemError ? { systemError: input.systemError } : {}),
    totalRewardAmount: BigInt(count("CONFIRMED")) * input.args.amount,
    transactionsSent: input.items.reduce((total, item) => total + item.transactionsSent, 0),
    walletIdEnd: input.args.walletIdEnd,
    walletIdStart: input.args.walletIdStart,
  };
}
