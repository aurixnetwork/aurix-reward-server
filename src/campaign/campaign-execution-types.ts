import type { TransactionRequest } from "ethers";

import type { RewardCampaign } from "../contracts/reward-contract-client.js";

export type CampaignOperationType =
  | "TBNB_GAS_TOPUP"
  | "CAMPAIGN_CREATE"
  | "IRB_TRANSFER";

export type CampaignOperationStatus =
  | "SIGNED"
  | "BROADCAST"
  | "CONFIRMED"
  | "FAILED"
  | "PENDING_REVIEW";

export interface CampaignReceiptLog {
  readonly address: string;
  readonly data: string;
  readonly topics: readonly string[];
}

export interface CampaignReceipt {
  readonly blockNumber: number;
  readonly gasPrice: bigint;
  readonly gasUsed: bigint;
  readonly hash: string;
  readonly logs: readonly CampaignReceiptLog[];
  readonly status: number | null;
}

export interface CampaignTransactionResponse {
  readonly hash: string;
  wait(confirmations?: number): Promise<CampaignReceipt | null>;
}

export interface CampaignExecutionProvider {
  broadcastTransaction(rawTransaction: string): Promise<CampaignTransactionResponse>;
  estimateGas(transaction: TransactionRequest): Promise<bigint>;
  getBalance(address: string): Promise<bigint>;
  getBlock(tag: "latest"): Promise<{
    readonly number: number;
    readonly timestamp: number;
  } | null>;
  getCode(address: string): Promise<string>;
  getFeeData(): Promise<{ readonly gasPrice: bigint | null }>;
  getNetwork(): Promise<{ readonly chainId: bigint }>;
  getTransaction(hash: string): Promise<{ readonly hash?: string } | null>;
  getTransactionCount(address: string, blockTag: "pending"): Promise<number>;
  getTransactionReceipt(hash: string): Promise<CampaignReceipt | null>;
}

export interface CampaignEvidenceRecord {
  readonly amountWei: bigint;
  readonly blockNumber?: number;
  readonly broadcastTxHash?: string;
  readonly expectedSender: string;
  readonly feePaidWei?: bigint;
  readonly operationId: string;
  readonly operationType: CampaignOperationType;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly signedTxHash: string;
  readonly status: CampaignOperationStatus;
}

export interface SignedCampaignEvidenceInput {
  readonly amountWei: bigint;
  readonly calldataHash: string;
  readonly expectedSender: string;
  readonly gasLimit: bigint;
  readonly gasPriceWei: bigint;
  readonly operationId: string;
  readonly operationType: CampaignOperationType;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly signedTxHash: string;
  readonly txNonce: number;
}

export interface CampaignEvidenceRepository {
  insertSigned(input: SignedCampaignEvidenceInput): Promise<void>;
  listAll(): Promise<readonly CampaignEvidenceRecord[]>;
  listUnresolved(): Promise<readonly CampaignEvidenceRecord[]>;
  markBroadcast(operationId: string, txHash: string): Promise<void>;
  markConfirmed(operationId: string, receipt: CampaignReceipt): Promise<void>;
  markFailed(operationId: string, code: string, receipt: CampaignReceipt): Promise<void>;
  markPendingReview(operationId: string, code: string): Promise<void>;
}

export interface CampaignReader {
  getCampaign(campaignId: string): Promise<RewardCampaign>;
  getClaimIntervalBounds(): Promise<{ readonly maximum: bigint; readonly minimum: bigint }>;
  getRoleId(role: "CAMPAIGN_MANAGER_ROLE"): Promise<string>;
  hasRole(role: string, account: string): Promise<boolean>;
  isPaused(): Promise<boolean>;
}

export interface IrbReader {
  balanceOf(account: string): Promise<bigint>;
  owner(): Promise<string>;
}
