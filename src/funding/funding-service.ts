import { createHash } from "node:crypto";

import { keccak256, Wallet, type TransactionRequest } from "ethers";

import { BSC_TESTNET_CHAIN_ID } from "../config/constants.js";
import { broadcastSameSignedTransaction } from "./funding-broadcast.js";
import { createFundingPlan } from "./funding-plan.js";
import type { FundingRepository } from "./funding-repository.js";
import type {
  FundingJobRecord,
  FundingPlan,
  FundingProvider,
  FundingWalletTarget,
} from "./funding-types.js";

export interface ExecuteFundingInput {
  readonly executionEnabled: boolean;
  readonly fundingPrivateKey: string;
  readonly maxGasPriceWei: bigint | undefined;
  readonly primaryProvider: FundingProvider;
  readonly broadcastProviders: readonly FundingProvider[];
  readonly repository: FundingRepository;
  readonly targetBalanceWei: bigint;
  readonly wallets: readonly FundingWalletTarget[];
}

export interface FundingExecutionResult {
  readonly confirmed: number;
  readonly failed: number;
  readonly pendingReview: number;
  readonly skipped: number;
  readonly transactionsSent: number;
}

export async function executeFundingBatch(
  input: ExecuteFundingInput,
): Promise<FundingExecutionResult> {
  if (!input.executionEnabled) {
    throw new Error("Funding execution is disabled; set FUNDING_EXECUTION_ENABLED=true only after owner review");
  }
  const signer = new Wallet(input.fundingPrivateKey);
  const plan = await createFundingPlan({
    fundingWalletAddress: signer.address,
    maxGasPriceWei: input.maxGasPriceWei,
    provider: input.primaryProvider,
    repository: input.repository,
    targetBalanceWei: input.targetBalanceWei,
    wallets: input.wallets,
  });
  assertExecutablePlan(plan);

  let nextNonce = await input.primaryProvider.getTransactionCount(signer.address, "pending");
  let confirmed = 0;
  let failed = 0;
  let pendingReview = 0;
  let skipped = 0;
  let transactionsSent = 0;

  for (const item of plan.wallets) {
    if (item.action === "SKIP_ACTIVE_JOB") {
      skipped += 1;
      continue;
    }
    const balanceBeforeWei = await input.primaryProvider.getBalance(item.walletAddress);
    const fundingAmountWei = balanceBeforeWei < input.targetBalanceWei
      ? input.targetBalanceWei - balanceBeforeWei
      : 0n;
    if (fundingAmountWei === 0n) {
      await input.repository.insertSkipped({
        balanceBeforeWei,
        fundingWalletAddress: signer.address,
        id: item.id,
        jobId: createFundingJobId("skip", item.id, item.walletAddress,
          input.targetBalanceWei.toString(), balanceBeforeWei.toString()),
        networkChainId: BSC_TESTNET_CHAIN_ID,
        reason: "SUFFICIENT_BALANCE",
        targetBalanceWei: input.targetBalanceWei,
        walletAddress: item.walletAddress,
      });
      skipped += 1;
      continue;
    }
    if (item.action !== "FUND") {
      // The wallet fell below target after preflight. It was not included in the
      // all-or-nothing funding liability, so a fresh plan is required.
      await input.repository.insertSkipped({
        balanceBeforeWei,
        fundingWalletAddress: signer.address,
        id: item.id,
        jobId: createFundingJobId("replan", item.id, item.walletAddress,
          input.targetBalanceWei.toString(), balanceBeforeWei.toString()),
        networkChainId: BSC_TESTNET_CHAIN_ID,
        reason: "REPLAN_REQUIRED",
        targetBalanceWei: input.targetBalanceWei,
        walletAddress: item.walletAddress,
      });
      skipped += 1;
      continue;
    }

    const gasLimit = item.gasLimit;
    const transaction: TransactionRequest = {
      chainId: BSC_TESTNET_CHAIN_ID,
      gasLimit,
      gasPrice: plan.feeDataGasPriceWei,
      nonce: nextNonce,
      to: item.walletAddress,
      type: 0,
      value: fundingAmountWei,
    };
    const rawTransaction = await signer.signTransaction(transaction);
    const signedTxHash = keccak256(rawTransaction);
    const jobId = createFundingJobId(
      "fund", BSC_TESTNET_CHAIN_ID.toString(), signer.address, item.id,
      item.walletAddress, nextNonce.toString(), fundingAmountWei.toString(),
      input.targetBalanceWei.toString(),
    );
    await input.repository.insertSigned({
      balanceBeforeWei,
      fundingAmountWei,
      fundingWalletAddress: signer.address,
      gasLimit,
      id: item.id,
      jobId,
      networkChainId: BSC_TESTNET_CHAIN_ID,
      signedTxHash,
      targetBalanceWei: input.targetBalanceWei,
      txNonce: nextNonce,
      walletAddress: item.walletAddress,
    });
    nextNonce += 1;

    let response;
    try {
      response = await broadcastSameSignedTransaction(
        rawTransaction,
        signedTxHash,
        input.broadcastProviders,
      );
      transactionsSent += 1;
      await input.repository.markBroadcast(jobId, response.hash);
    } catch {
      await input.repository.markPendingReview(
        jobId,
        "BROADCAST_UNCERTAIN",
        "RPC broadcast did not return a definitive result; reconcile signed hash",
      );
      pendingReview += 1;
      continue;
    }

    let receipt;
    try {
      receipt = await response.wait(1);
    } catch {
      await input.repository.markPendingReview(
        jobId,
        "RECEIPT_TIMEOUT",
        "Receipt wait was inconclusive; transaction may still be pending",
      );
      pendingReview += 1;
      continue;
    }
    if (!receipt) {
      await input.repository.markPendingReview(
        jobId,
        "RECEIPT_PENDING",
        "No receipt is available yet",
      );
      pendingReview += 1;
      continue;
    }
    if (receipt.status !== 1) {
      await input.repository.markFailed(jobId, "TRANSACTION_REVERTED", "Funding transaction reverted", receipt);
      failed += 1;
      continue;
    }
    const balanceAfterWei = await input.primaryProvider.getBalance(item.walletAddress);
    if (balanceAfterWei < balanceBeforeWei + fundingAmountWei) {
      await input.repository.markPendingReview(
        jobId,
        "BALANCE_VERIFICATION_FAILED",
        "Successful receipt did not produce the expected observed recipient balance",
        receipt,
        balanceAfterWei,
      );
      pendingReview += 1;
      continue;
    }
    await input.repository.markConfirmed(jobId, receipt, balanceAfterWei);
    confirmed += 1;
  }

  return { confirmed, failed, pendingReview, skipped, transactionsSent };
}

export async function reconcileFundingJobs(
  repository: FundingRepository,
  providers: readonly FundingProvider[],
): Promise<{ readonly inspected: number; readonly updated: number }> {
  const jobs = await repository.listUnresolved();
  let updated = 0;
  for (const job of jobs) {
    const hash = job.broadcastTxHash ?? job.signedTxHash;
    if (!hash) continue;
    const receipt = await findReceipt(providers, hash);
    if (receipt) {
      if (receipt.status === 1) {
        const balanceAfterWei = await providers[0]?.getBalance(job.walletAddress);
        if (
          balanceAfterWei !== undefined &&
          balanceAfterWei >= job.balanceBeforeWei + job.fundingAmountWei
        ) {
          await repository.markConfirmed(job.jobId, receipt, balanceAfterWei);
          updated += 1;
        }
      } else {
        await repository.markFailed(job.jobId, "TRANSACTION_REVERTED", "Funding transaction reverted", receipt);
        updated += 1;
      }
      continue;
    }
    if (!job.broadcastTxHash && await transactionAppears(providers, hash)) {
      await repository.markBroadcast(job.jobId, hash);
      updated += 1;
    }
  }
  return { inspected: jobs.length, updated };
}

function assertExecutablePlan(plan: FundingPlan): void {
  if (!plan.gasPriceWithinMaximum) {
    throw new Error("Observed gas price exceeds MAX_FUNDING_GAS_PRICE_GWEI; no transactions sent");
  }
  if (!plan.sufficientFundingBalance) {
    throw new Error("Funding Wallet balance is insufficient for the complete batch; no transactions sent");
  }
}

function createFundingJobId(...parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

async function findReceipt(providers: readonly FundingProvider[], hash: string) {
  for (const provider of providers) {
    try {
      const receipt = await provider.getTransactionReceipt(hash);
      if (receipt) return receipt;
    } catch { /* try the next read endpoint */ }
  }
  return null;
}

async function transactionAppears(providers: readonly FundingProvider[], hash: string): Promise<boolean> {
  for (const provider of providers) {
    try {
      if (await provider.getTransaction(hash)) return true;
    } catch { /* try the next read endpoint */ }
  }
  return false;
}

export type { FundingJobRecord };
