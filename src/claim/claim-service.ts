import { createHash } from "node:crypto";

import { getAddress, keccak256, Wallet } from "ethers";

import type { AuthorizationRepository } from "../authorization/authorization-repository.js";
import type { AuthorizationJobRecord } from "../authorization/authorization-types.js";
import type { WalletEncryptionConfig } from "../config/environment.js";
import { decryptWalletPrivateKey } from "../wallets/wallet-crypto.js";
import type { EncryptedWalletRecord } from "../wallets/wallet-types.js";
import { broadcastSameSignedClaim } from "./claim-broadcast.js";
import {
  ClaimConfirmationError,
  validateConfirmedClaim,
} from "./claim-confirmation.js";
import { ClaimExecutionError } from "./claim-execution-error.js";
import type { ClaimRepository } from "./claim-repository.js";
import type {
  ClaimChainReader,
  ClaimJobRecord,
  ClaimPlan,
  ClaimProvider,
  ClaimTokenReader,
} from "./claim-types.js";

export interface ExecuteClaimInput {
  readonly authorization: AuthorizationJobRecord;
  readonly broadcastProviders: readonly ClaimProvider[];
  readonly encryption: WalletEncryptionConfig;
  readonly executionEnabled: boolean;
  readonly plan: ClaimPlan;
  readonly reader: ClaimChainReader;
  readonly repository: ClaimRepository;
  readonly rewardContractAddress: string;
  readonly token: ClaimTokenReader;
  readonly wallet: EncryptedWalletRecord;
}

export interface ClaimExecutionResult {
  readonly claimJobId: string;
  readonly status: "CONFIRMED" | "FAILED" | "PENDING_REVIEW";
  readonly transactionsSent: number;
  readonly txHash: string;
}

export async function executeClaim(input: ExecuteClaimInput): Promise<ClaimExecutionResult> {
  if (!input.executionEnabled) {
    throw new ClaimExecutionError("CLAIM_EXECUTION_DISABLED");
  }
  if (input.plan.expectedAction !== "SIGN_AND_BROADCAST" || input.plan.blockers.length > 0) {
    throw new ClaimExecutionError("CLAIM_PLAN_NOT_EXECUTABLE");
  }
  if (!input.plan.transaction || input.plan.gasLimit === undefined || input.plan.gasPriceWei === undefined) {
    throw new ClaimExecutionError("CLAIM_TRANSACTION_INCOMPLETE");
  }
  if (input.wallet.status !== "ACTIVE" || input.wallet.id !== input.authorization.walletId) {
    throw new ClaimExecutionError("CLAIM_WALLET_INVALID");
  }
  if (input.wallet.encryptionKeyVersion !== input.encryption.version) {
    throw new ClaimExecutionError("CLAIM_ENCRYPTION_VERSION_MISMATCH");
  }

  const txNonce = input.plan.currentEthereumTxNonce;
  if (txNonce === undefined) throw new ClaimExecutionError("CLAIM_NONCE_MISSING");
  const campaign = input.plan.campaign;
  if (!campaign) throw new ClaimExecutionError("CLAIM_CAMPAIGN_STATE_MISSING");
  const { rawTransaction, signedTxHash } = await signWithEncryptedUserWallet(
    input.plan.transaction,
    input.wallet,
    input.authorization.claimant,
    input.encryption,
  );
  const claimJobId = createClaimJobId(
    input.authorization.jobId,
    input.authorization.rewardId,
    txNonce,
    signedTxHash,
  );
  try {
    await input.repository.insertSigned({
      amount: input.authorization.amount,
      authorizationJobId: input.authorization.jobId,
      campaignDistributedBefore: campaign.distributed,
      campaignId: input.authorization.campaignId,
      claimant: input.authorization.claimant,
      gasLimit: input.plan.gasLimit,
      gasPriceWei: input.plan.gasPriceWei,
      irbBalanceBefore: input.plan.irbBalance,
      jobId: claimJobId,
      rewardContractBalanceBefore: input.plan.rewardContractIrbBalance,
      rewardId: input.authorization.rewardId,
      rewardNonce: input.authorization.rewardNonce,
      signedTxHash,
      txNonce,
      walletId: input.authorization.walletId,
    });
  } catch {
    throw new ClaimExecutionError("CLAIM_SIGNED_PERSIST_FAILED");
  }

  let response;
  try {
    response = await broadcastSameSignedClaim(
      rawTransaction,
      signedTxHash,
      input.broadcastProviders,
    );
    await input.repository.markBroadcast(claimJobId, response.hash);
  } catch {
    await input.repository.markPendingReview(
      claimJobId,
      "BROADCAST_UNCERTAIN",
      "Broadcast was inconclusive; reconcile the persisted signed transaction hash",
    );
    return { claimJobId, status: "PENDING_REVIEW", transactionsSent: 0, txHash: signedTxHash };
  }

  let receipt;
  try {
    receipt = await response.wait(1);
  } catch {
    await input.repository.markPendingReview(
      claimJobId,
      "RECEIPT_TIMEOUT",
      "Receipt wait was inconclusive; do not create a replacement transaction",
    );
    return { claimJobId, status: "PENDING_REVIEW", transactionsSent: 1, txHash: signedTxHash };
  }
  if (!receipt) {
    await input.repository.markPendingReview(
      claimJobId,
      "RECEIPT_PENDING",
      "No receipt is available yet; reconciliation is required",
    );
    return { claimJobId, status: "PENDING_REVIEW", transactionsSent: 1, txHash: signedTxHash };
  }
  if (receipt.status !== 1) {
    await input.repository.markFailed(
      claimJobId,
      "TRANSACTION_REVERTED",
      "Claim transaction reverted; authorization remains READY pending explicit review",
      receipt,
    );
    return { claimJobId, status: "FAILED", transactionsSent: 1, txHash: signedTxHash };
  }

  const persistedJob = await input.repository.findByAuthorizationJobId(
    input.authorization.jobId,
  );
  if (!persistedJob) throw new Error("Persisted claim job could not be reloaded");
  try {
    const confirmation = await validateConfirmedClaim({
      authorization: input.authorization,
      expectedApprover: input.plan.recoveredApprover ?? input.authorization.approverAddress,
      job: persistedJob,
      reader: input.reader,
      receipt,
      rewardContractAddress: input.rewardContractAddress,
      token: input.token,
    });
    await input.repository.markConfirmed(
      claimJobId,
      input.authorization.jobId,
      { ...confirmation, receipt },
    );
    return { claimJobId, status: "CONFIRMED", transactionsSent: 1, txHash: signedTxHash };
  } catch (error: unknown) {
    const code = error instanceof ClaimConfirmationError
      ? error.code
      : "POST_CLAIM_VALIDATION_FAILED";
    await input.repository.markPendingReview(
      claimJobId,
      code,
      "Successful receipt did not pass exact event and state validation",
      receipt,
    );
    return { claimJobId, status: "PENDING_REVIEW", transactionsSent: 1, txHash: signedTxHash };
  }
}

export async function reconcileClaimJobs(input: {
  readonly authorizationRepository: AuthorizationRepository;
  readonly providers: readonly ClaimProvider[];
  readonly reader: ClaimChainReader;
  readonly repository: ClaimRepository;
  readonly rewardContractAddress: string;
  readonly token: ClaimTokenReader;
}): Promise<{ readonly inspected: number; readonly updated: number }> {
  const jobs = await input.repository.listUnresolved();
  let updated = 0;
  for (const job of jobs) {
    const authorization = await input.authorizationRepository.findByJobId(job.authorizationJobId);
    if (!authorization) {
      await input.repository.markPendingReview(
        job.jobId,
        "AUTHORIZATION_NOT_FOUND",
        "Persisted authorization is missing during reconciliation",
      );
      updated += 1;
      continue;
    }
    const hash = job.broadcastTxHash ?? job.signedTxHash;
    const receipt = await findReceipt(input.providers, hash);
    if (receipt) {
      if (receipt.status !== 1) {
        await input.repository.markFailed(
          job.jobId,
          "TRANSACTION_REVERTED",
          "Reconciled claim receipt reverted; authorization remains unconsumed",
          receipt,
        );
        updated += 1;
        continue;
      }
      try {
        const confirmation = await validateConfirmedClaim({
          authorization,
          expectedApprover: authorization.approverAddress,
          job,
          reader: input.reader,
          receipt,
          rewardContractAddress: input.rewardContractAddress,
          token: input.token,
        });
        await input.repository.markConfirmed(
          job.jobId,
          authorization.jobId,
          { ...confirmation, receipt },
        );
      } catch (error: unknown) {
        await input.repository.markPendingReview(
          job.jobId,
          error instanceof ClaimConfirmationError ? error.code : "RECONCILIATION_VALIDATION_FAILED",
          "Reconciled receipt requires manual review",
          receipt,
        );
      }
      updated += 1;
      continue;
    }
    if (!job.broadcastTxHash && await transactionAppears(input.providers, hash)) {
      await input.repository.markBroadcast(job.jobId, hash);
      updated += 1;
      continue;
    }
    const [used, claimantState] = await Promise.all([
      input.reader.isRewardIdUsed(job.rewardId),
      input.reader.getClaimantState(job.campaignId, job.claimant),
    ]);
    if (used || claimantState.rewardNonce > job.rewardNonce) {
      await input.repository.markPendingReview(
        job.jobId,
        "ON_CHAIN_CONSUMPTION_WITHOUT_RECEIPT",
        "rewardId or rewardNonce advanced but the known transaction receipt is unavailable",
      );
      updated += 1;
    }
  }
  return { inspected: jobs.length, updated };
}

async function signWithEncryptedUserWallet(
  transaction: ClaimPlan["transaction"] & object,
  walletRecord: EncryptedWalletRecord,
  claimant: string,
  encryption: WalletEncryptionConfig,
): Promise<{ readonly rawTransaction: string; readonly signedTxHash: string }> {
  let signer: Wallet;
  try {
    const privateKey = decryptWalletPrivateKey(
      walletRecord,
      walletRecord.walletAddress,
      encryption.key,
    );
    signer = new Wallet(privateKey);
  } catch {
    throw new ClaimExecutionError("CLAIM_WALLET_INVALID");
  }
  if (
    signer.address !== getAddress(walletRecord.walletAddress) ||
    signer.address !== getAddress(claimant)
  ) {
    throw new ClaimExecutionError("CLAIM_WALLET_INVALID");
  }
  try {
    const rawTransaction = await signer.signTransaction(transaction);
    return { rawTransaction, signedTxHash: keccak256(rawTransaction) };
  } catch {
    throw new ClaimExecutionError("CLAIM_SIGNING_FAILED");
  }
}

function createClaimJobId(
  authorizationJobId: string,
  rewardId: string,
  transactionNonce: number,
  signedTxHash: string,
): string {
  return createHash("sha256")
    .update([authorizationJobId, rewardId, transactionNonce.toString(), signedTxHash].join("|"))
    .digest("hex");
}

async function findReceipt(
  providers: readonly ClaimProvider[],
  hash: string,
) {
  for (const provider of providers) {
    try {
      const receipt = await provider.getTransactionReceipt(hash);
      if (receipt) return receipt;
    } catch {
      // Try the next read endpoint.
    }
  }
  return null;
}

async function transactionAppears(
  providers: readonly ClaimProvider[],
  hash: string,
): Promise<boolean> {
  for (const provider of providers) {
    try {
      if (await provider.getTransaction(hash)) return true;
    } catch {
      // Try the next read endpoint.
    }
  }
  return false;
}

export type { ClaimJobRecord };
