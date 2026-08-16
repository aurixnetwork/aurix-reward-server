import type { Log, TransactionRequest } from "ethers";

import type { AuthorizationJobRecord } from "../authorization/authorization-types.js";
import type {
  RewardCampaign,
  RewardClaimantState,
} from "../contracts/reward-contract-client.js";

export type ClaimJobStatus =
  | "PLANNED"
  | "SIGNED"
  | "BROADCAST"
  | "CONFIRMED"
  | "FAILED"
  | "PENDING_REVIEW"
  | "BLOCKED";

export type ClaimExpectedAction =
  | "SIGN_AND_BROADCAST"
  | "RECONCILE_EXISTING"
  | "RECONCILE_REWARD_ALREADY_USED"
  | "SKIP_ALREADY_CONFIRMED"
  | "BLOCKED";

export type ClaimBlockCode =
  | "BLOCKED_WRONG_CHAIN"
  | "BLOCKED_REWARD_CONTRACT_CODE_MISSING"
  | "BLOCKED_IRB_CODE_MISSING"
  | "BLOCKED_REWARD_TOKEN_MISMATCH"
  | "BLOCKED_CONTRACT_PAUSED"
  | "BLOCKED_CAMPAIGN_NOT_FOUND"
  | "BLOCKED_CAMPAIGN_INACTIVE"
  | "BLOCKED_CAMPAIGN_NOT_STARTED"
  | "BLOCKED_CAMPAIGN_ENDED"
  | "BLOCKED_ZERO_AMOUNT"
  | "BLOCKED_AMOUNT_EXCEEDS_MAX"
  | "BLOCKED_CAMPAIGN_BUDGET"
  | "BLOCKED_REWARD_CONTRACT_IRB"
  | "BLOCKED_AUTHORIZATION_NOT_READY"
  | "BLOCKED_AUTHORIZATION_EXPIRED"
  | "BLOCKED_AUTHORIZATION_NOT_YET_VALID"
  | "BLOCKED_REWARD_ID_USED"
  | "BLOCKED_STALE_REWARD_NONCE"
  | "BLOCKED_USER_WALLET_NOT_FOUND"
  | "BLOCKED_USER_WALLET_INACTIVE"
  | "BLOCKED_CLAIMANT_MISMATCH"
  | "BLOCKED_INVALID_AUTHORIZATION_HASH"
  | "BLOCKED_INVALID_APPROVER_SIGNATURE"
  | "BLOCKED_WRONG_APPROVER"
  | "BLOCKED_APPROVER_ROLE_MISSING"
  | "BLOCKED_CLAIM_INTERVAL"
  | "BLOCKED_GAS_PRICE_UNAVAILABLE"
  | "BLOCKED_GAS_PRICE_LIMIT"
  | "BLOCKED_INSUFFICIENT_USER_GAS"
  | "BLOCKED_EXISTING_CLAIM_JOB"
  | "BLOCKED_PREFLIGHT_READ_FAILED";

export interface ClaimBlocker {
  readonly code: ClaimBlockCode;
  readonly reason: string;
}

export interface RewardClaimedEvent {
  readonly amount: bigint;
  readonly approver: string;
  readonly campaignId: string;
  readonly claimant: string;
  readonly claimTimestamp: bigint;
  readonly consumedRewardNonce: bigint;
  readonly logIndex: number;
  readonly rewardId: string;
}

export interface ClaimReceipt {
  readonly blockNumber: number;
  readonly gasPrice: bigint;
  readonly gasUsed: bigint;
  readonly hash: string;
  readonly logs: readonly Pick<Log, "address" | "data" | "index" | "topics">[];
  readonly status: number | null;
}

export interface ClaimTransactionResponse {
  readonly hash: string;
  wait(confirmations?: number): Promise<ClaimReceipt | null>;
}

export interface ClaimProvider {
  broadcastTransaction(rawTransaction: string): Promise<ClaimTransactionResponse>;
  estimateGas(transaction: TransactionRequest): Promise<bigint>;
  getBalance(address: string): Promise<bigint>;
  getBlock(tag: "latest"): Promise<{ readonly timestamp: number } | null>;
  getCode(address: string): Promise<string>;
  getFeeData(): Promise<{ readonly gasPrice: bigint | null }>;
  getNetwork(): Promise<{ readonly chainId: bigint }>;
  getTransaction(hash: string): Promise<{ readonly hash?: string } | null>;
  getTransactionCount(address: string, blockTag: "pending"): Promise<number>;
  getTransactionReceipt(hash: string): Promise<ClaimReceipt | null>;
}

export interface ClaimChainReader {
  getCampaign(campaignId: string): Promise<RewardCampaign>;
  getClaimantState(campaignId: string, claimant: string): Promise<RewardClaimantState>;
  getRewardToken(): Promise<string>;
  hasApproverRole(account: string): Promise<boolean>;
  isPaused(): Promise<boolean>;
  isRewardIdUsed(rewardId: string): Promise<boolean>;
}

export interface ClaimTokenReader {
  balanceOf(account: string): Promise<bigint>;
}

export interface ClaimJobRecord {
  readonly amount: bigint;
  readonly authorizationJobId: string;
  readonly blockNumber?: number;
  readonly broadcastTxHash?: string;
  readonly campaignDistributedAfter?: bigint;
  readonly campaignDistributedBefore: bigint;
  readonly campaignId: string;
  readonly claimant: string;
  readonly effectiveGasPriceWei?: bigint;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly feePaidWei?: bigint;
  readonly gasLimit: bigint;
  readonly gasPriceWei: bigint;
  readonly gasUsed?: bigint;
  readonly irbBalanceAfter?: bigint;
  readonly irbBalanceBefore: bigint;
  readonly jobId: string;
  readonly lastClaimAtAfter?: bigint;
  readonly receipt?: ClaimReceipt;
  readonly rewardClaimedEvent?: RewardClaimedEvent;
  readonly rewardClaimedEventValidated?: boolean;
  readonly rewardContractBalanceAfter?: bigint;
  readonly rewardContractBalanceBefore: bigint;
  readonly rewardId: string;
  readonly rewardNonce: bigint;
  readonly signedTxHash: string;
  readonly status: ClaimJobStatus;
  readonly txNonce: number;
  readonly walletId: string;
}

export interface SignedClaimJobInput {
  readonly amount: bigint;
  readonly authorizationJobId: string;
  readonly campaignDistributedBefore: bigint;
  readonly campaignId: string;
  readonly claimant: string;
  readonly gasLimit: bigint;
  readonly gasPriceWei: bigint;
  readonly irbBalanceBefore: bigint;
  readonly jobId: string;
  readonly rewardContractBalanceBefore: bigint;
  readonly rewardId: string;
  readonly rewardNonce: bigint;
  readonly signedTxHash: string;
  readonly txNonce: number;
  readonly walletId: string;
}

export interface ClaimPlan {
  readonly authorization: AuthorizationJobRecord;
  readonly blockers: readonly ClaimBlocker[];
  readonly campaign?: RewardCampaign;
  readonly claimantState?: RewardClaimantState;
  readonly currentEthereumTxNonce?: number;
  readonly estimatedFeeWei?: bigint;
  readonly estimatedGas?: bigint;
  readonly expectedAction: ClaimExpectedAction;
  readonly gasLimit?: bigint;
  readonly gasPriceWei?: bigint;
  readonly irbBalance: bigint;
  readonly latestBlockTimestamp: bigint;
  readonly recoveredApprover?: string;
  readonly rewardContractIrbBalance: bigint;
  readonly transaction?: TransactionRequest;
  readonly transactionsSent: 0;
  readonly userGasBalanceWei: bigint;
  readonly walletAddress?: string;
}

export interface ClaimPostState {
  readonly campaignDistributedAfter: bigint;
  readonly irbBalanceAfter: bigint;
  readonly lastClaimAtAfter: bigint;
  readonly rewardContractBalanceAfter: bigint;
  readonly rewardIdUsed: boolean;
  readonly rewardNonceAfter: bigint;
}
