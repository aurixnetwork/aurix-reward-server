import type { TransactionRequest } from "ethers";

export type FundingJobStatus =
  | "PLANNED"
  | "SIGNED"
  | "BROADCAST"
  | "CONFIRMED"
  | "SKIPPED"
  | "FAILED"
  | "PENDING_REVIEW";

export type FundingPlanAction =
  | "FUND"
  | "SKIP_SUFFICIENT_BALANCE"
  | "SKIP_ACTIVE_JOB";

export interface FundingWalletTarget {
  readonly id: string;
  readonly walletAddress: string;
}

export interface FundingPlanItem extends FundingWalletTarget {
  readonly action: FundingPlanAction;
  readonly activeJobId?: string;
  readonly balanceBeforeWei: bigint;
  readonly fundingAmountWei: bigint;
  readonly gasLimit: bigint;
  readonly estimatedGasCostWei: bigint;
  readonly targetBalanceWei: bigint;
}

export interface FundingPlan {
  readonly chainId: number;
  readonly estimatedGasCostWei: bigint;
  readonly feeDataGasPriceWei: bigint;
  readonly fundingWalletAddress: string;
  readonly fundingWalletBalanceWei: bigint;
  readonly gasPriceWithinMaximum: boolean;
  readonly sufficientFundingBalance: boolean;
  readonly totalRequiredWei: bigint;
  readonly totalTopUpRequiredWei: bigint;
  readonly transactionsPlanned: number;
  readonly transactionsSent: 0;
  readonly wallets: readonly FundingPlanItem[];
}

export interface FundingReceipt {
  readonly blockNumber: number;
  readonly gasPrice: bigint;
  readonly gasUsed: bigint;
  readonly hash: string;
  readonly status: number | null;
}

export interface FundingTransactionResponse {
  readonly hash: string;
  wait(confirmations?: number): Promise<FundingReceipt | null>;
}

export interface FundingProvider {
  broadcastTransaction(rawTransaction: string): Promise<FundingTransactionResponse>;
  estimateGas(transaction: TransactionRequest): Promise<bigint>;
  getBalance(address: string): Promise<bigint>;
  getFeeData(): Promise<{ readonly gasPrice: bigint | null }>;
  getNetwork(): Promise<{ readonly chainId: bigint }>;
  getTransaction(hash: string): Promise<{ readonly hash?: string } | null>;
  getTransactionCount(address: string, blockTag: "pending"): Promise<number>;
  getTransactionReceipt(hash: string): Promise<FundingReceipt | null>;
}

export interface FundingJobRecord extends FundingWalletTarget {
  readonly balanceBeforeWei: bigint;
  readonly blockNumber?: number;
  readonly broadcastTxHash?: string;
  readonly feePaidWei?: bigint;
  readonly fundingAmountWei: bigint;
  readonly jobId: string;
  readonly signedTxHash?: string;
  readonly status: FundingJobStatus;
}

export interface SignedFundingJobInput extends FundingWalletTarget {
  readonly balanceBeforeWei: bigint;
  readonly fundingAmountWei: bigint;
  readonly fundingWalletAddress: string;
  readonly gasLimit: bigint;
  readonly jobId: string;
  readonly networkChainId: number;
  readonly signedTxHash: string;
  readonly targetBalanceWei: bigint;
  readonly txNonce: number;
}

export interface SkippedFundingJobInput extends FundingWalletTarget {
  readonly balanceBeforeWei: bigint;
  readonly fundingWalletAddress: string;
  readonly jobId: string;
  readonly networkChainId: number;
  readonly reason: "ACTIVE_JOB" | "REPLAN_REQUIRED" | "SUFFICIENT_BALANCE";
  readonly targetBalanceWei: bigint;
}
