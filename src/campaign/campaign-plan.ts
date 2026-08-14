import {
  getAddress,
  id,
  Interface,
  MaxUint256,
  parseEther,
  parseUnits,
  type TransactionRequest,
} from "ethers";

import rewardContractAbi from "../contracts/abi/AurixRewardClaim.json" with { type: "json" };
import type { IrbTokenClient } from "../contracts/irb-token-client.js";
import type {
  RewardCampaign,
  RewardContractClient,
} from "../contracts/reward-contract-client.js";
import {
  AURIX_REWARD_CONTRACT_ADDRESS,
  BSC_TESTNET_CHAIN_ID,
  DEFAULT_TEST_WALLET_COUNT,
  IRB_TEST_TOKEN_ADDRESS,
  TESTNET_ADMIN_ADDRESS,
  TESTNET_APPROVER_ADDRESS,
  TESTNET_OPERATIONS_ADDRESS,
} from "../config/constants.js";

export const TEST_CAMPAIGN_LABEL = "AURIX_TEST_REWARD_CAMPAIGN_V1";
export const TEST_CAMPAIGN_REWARD_PER_CLAIM = parseUnits("0.1", 18);
export const TEST_CAMPAIGN_ROUNDS = 3;
export const TEST_CAMPAIGN_CLAIM_INTERVAL_SECONDS = 3_600n;
export const TEST_CAMPAIGN_START_DELAY_SECONDS = 86_400n;
export const TEST_CAMPAIGN_DURATION_SECONDS = 604_800n;
export const TEST_CAMPAIGN_SAFETY_BUFFER_BPS = 1_000n;
export const OPERATIONS_TBNB_TARGET = parseEther("0.001");

const UINT64_MAX = (1n << 64n) - 1n;
const BPS_DENOMINATOR = 10_000n;
const rewardInterface = new Interface(rewardContractAbi);
const tokenInterface = new Interface([
  "function transfer(address recipient, uint256 amount) returns (bool)",
]);

export interface CampaignPlanProvider {
  estimateGas(transaction: TransactionRequest): Promise<bigint>;
  getBalance(address: string): Promise<bigint>;
  getBlock(tag: "latest"): Promise<{
    readonly number: number;
    readonly timestamp: number;
  } | null>;
  getFeeData(): Promise<{ readonly gasPrice: bigint | null }>;
  getNetwork(): Promise<{ readonly chainId: bigint }>;
}

export interface TestCampaignProposal {
  readonly active: true;
  readonly budget: bigint;
  readonly campaignId: string;
  readonly claimInterval: bigint;
  readonly duration: bigint;
  readonly endTime: bigint;
  readonly label: string;
  readonly maxRewardAmount: bigint;
  readonly rounds: number;
  readonly startTime: bigint;
  readonly walletCount: number;
}

export type CampaignPlanBlocker =
  | "ACTIVE_WALLET_COUNT_MISMATCH"
  | "ADMIN_TBNB_INSUFFICIENT"
  | "CAMPAIGN_ALREADY_EXISTS"
  | "IRB_SOURCE_GAS_INSUFFICIENT"
  | "IRB_SOURCE_INSUFFICIENT"
  | "OPERATIONS_MISSING_CAMPAIGN_MANAGER_ROLE"
  | "OPERATIONS_TBNB_INSUFFICIENT_AFTER_TOPUP";

export interface PlannedCampaignTransaction {
  readonly amountWei?: bigint;
  readonly estimatedFeeWei: bigint;
  readonly estimatedGas: bigint;
  readonly expectedEvent?: string;
  readonly expectedStateChange: string;
  readonly function: string;
  readonly kind: "CAMPAIGN_CREATE" | "IRB_TRANSFER" | "TBNB_GAS_TOPUP";
  readonly nativeValueWei: bigint;
  readonly order: number;
  readonly requiredRole: string | null;
  readonly sender: string;
  readonly senderSufficient: boolean;
  readonly to: string;
}

export interface CampaignCreationPlan {
  readonly activeWalletCount: number;
  readonly balances: {
    readonly adminIrb: bigint;
    readonly adminTbnb: bigint;
    readonly approverIrb: bigint;
    readonly operationsIrb: bigint;
    readonly operationsTbnb: bigint;
    readonly rewardContractIrb: bigint;
    readonly tokenOwnerIrb: bigint;
    readonly tokenOwnerTbnb: bigint;
  };
  readonly blockNumber: number;
  readonly blockers: readonly CampaignPlanBlocker[];
  readonly campaignExists: boolean;
  readonly chainId: number;
  readonly contractPaused: boolean;
  readonly funding: {
    readonly oneRoundRequired: bigint;
    readonly recommendedContractBalance: bigint;
    readonly requiredTopUp: bigint;
    readonly safetyBuffer: bigint;
    readonly totalRoundsRequired: bigint;
  };
  readonly gasPriceWei: bigint;
  readonly intervalBounds: { readonly maximum: bigint; readonly minimum: bigint };
  readonly proposal: TestCampaignProposal;
  readonly proposalStatus: "RECOMMENDED_NOT_APPROVED";
  readonly roles: {
    readonly approverRole: string;
    readonly approverRoleHeldByApprover: boolean;
    readonly campaignManagerRole: string;
    readonly campaignManagerRoleHeldByAdmin: boolean;
    readonly campaignManagerRoleHeldByOperations: boolean;
    readonly defaultAdminRole: string;
    readonly defaultAdminRoleHeldByAdmin: boolean;
    readonly treasuryRole: string;
    readonly treasuryRoleHeldByAdmin: boolean;
  };
  readonly status: "BLOCKED" | "READY_FOR_OWNER_REVIEW";
  readonly tokenOwner: string;
  readonly totalEstimatedGas: bigint;
  readonly totalEstimatedGasFeeWei: bigint;
  readonly transactions: readonly PlannedCampaignTransaction[];
  readonly transactionsSent: 0;
}

export interface CreateCampaignPlanInput {
  readonly activeWalletCount: number;
  readonly irbClient: Pick<IrbTokenClient, "balanceOf" | "owner">;
  readonly provider: CampaignPlanProvider;
  readonly rewardClient: Pick<
    RewardContractClient,
    "getCampaign" | "getClaimIntervalBounds" | "getRoleId" | "hasRole" | "isPaused"
  >;
}

export function deriveCampaignId(label: string): string {
  if (label.trim() !== label || label.length === 0) {
    throw new Error("Campaign label must be non-empty canonical text without surrounding whitespace");
  }
  return id(label);
}

export function createTestCampaignProposal(
  latestBlockTimestamp: number,
): TestCampaignProposal {
  if (!Number.isSafeInteger(latestBlockTimestamp) || latestBlockTimestamp < 0) {
    throw new Error("Latest block timestamp must be non-negative Unix seconds");
  }
  const startTime = BigInt(latestBlockTimestamp) + TEST_CAMPAIGN_START_DELAY_SECONDS;
  const endTime = startTime + TEST_CAMPAIGN_DURATION_SECONDS;
  const budget =
    TEST_CAMPAIGN_REWARD_PER_CLAIM *
    BigInt(DEFAULT_TEST_WALLET_COUNT) *
    BigInt(TEST_CAMPAIGN_ROUNDS);
  return {
    active: true,
    budget,
    campaignId: deriveCampaignId(TEST_CAMPAIGN_LABEL),
    claimInterval: TEST_CAMPAIGN_CLAIM_INTERVAL_SECONDS,
    duration: TEST_CAMPAIGN_DURATION_SECONDS,
    endTime,
    label: TEST_CAMPAIGN_LABEL,
    maxRewardAmount: TEST_CAMPAIGN_REWARD_PER_CLAIM,
    rounds: TEST_CAMPAIGN_ROUNDS,
    startTime,
    walletCount: DEFAULT_TEST_WALLET_COUNT,
  };
}

export function validateCampaignProposal(
  proposal: TestCampaignProposal,
  intervalBounds: { readonly maximum: bigint; readonly minimum: bigint },
): void {
  if (proposal.campaignId === `0x${"00".repeat(32)}`) throw new Error("Campaign ID must be nonzero");
  if (proposal.budget <= 0n || proposal.budget > MaxUint256) {
    throw new Error("Campaign budget must be a positive uint256");
  }
  if (proposal.maxRewardAmount <= 0n || proposal.maxRewardAmount > proposal.budget) {
    throw new Error("Campaign maximum must be positive and no greater than budget");
  }
  if (
    proposal.startTime < 0n || proposal.endTime > UINT64_MAX ||
    proposal.startTime >= proposal.endTime
  ) {
    throw new Error("Campaign start/end must be an increasing uint64 time range");
  }
  if (
    proposal.claimInterval < intervalBounds.minimum ||
    proposal.claimInterval > intervalBounds.maximum
  ) {
    throw new Error("Campaign claim interval is outside deployed contract bounds");
  }
}

export async function createTestCampaignCreationPlan(
  input: CreateCampaignPlanInput,
): Promise<CampaignCreationPlan> {
  const [network, block, feeData] = await Promise.all([
    input.provider.getNetwork(),
    input.provider.getBlock("latest"),
    input.provider.getFeeData(),
  ]);
  const chainId = Number(network.chainId);
  if (chainId !== BSC_TESTNET_CHAIN_ID) {
    throw new Error(`Campaign planning is restricted to BSC Testnet chain ID ${BSC_TESTNET_CHAIN_ID}`);
  }
  if (!block) throw new Error("RPC did not return the latest block");
  if (feeData.gasPrice === null || feeData.gasPrice <= 0n) {
    throw new Error("RPC did not return a usable legacy gas price");
  }

  const proposal = createTestCampaignProposal(block.timestamp);
  const intervalBounds = await input.rewardClient.getClaimIntervalBounds();
  validateCampaignProposal(proposal, intervalBounds);

  const [
    campaign,
    contractPaused,
    defaultAdminRole,
    campaignManagerRole,
    treasuryRole,
    approverRole,
    tokenOwner,
  ] = await Promise.all([
    input.rewardClient.getCampaign(proposal.campaignId),
    input.rewardClient.isPaused(),
    input.rewardClient.getRoleId("DEFAULT_ADMIN_ROLE"),
    input.rewardClient.getRoleId("CAMPAIGN_MANAGER_ROLE"),
    input.rewardClient.getRoleId("TREASURY_ROLE"),
    input.rewardClient.getRoleId("APPROVER_ROLE"),
    input.irbClient.owner(),
  ]);

  const normalizedTokenOwner = getAddress(tokenOwner);
  const [
    adminIrb,
    operationsIrb,
    approverIrb,
    rewardContractIrb,
    tokenOwnerIrb,
    adminTbnb,
    operationsTbnb,
    tokenOwnerTbnb,
    defaultAdminRoleHeldByAdmin,
    campaignManagerRoleHeldByAdmin,
    campaignManagerRoleHeldByOperations,
    treasuryRoleHeldByAdmin,
    approverRoleHeldByApprover,
  ] = await Promise.all([
    input.irbClient.balanceOf(TESTNET_ADMIN_ADDRESS),
    input.irbClient.balanceOf(TESTNET_OPERATIONS_ADDRESS),
    input.irbClient.balanceOf(TESTNET_APPROVER_ADDRESS),
    input.irbClient.balanceOf(AURIX_REWARD_CONTRACT_ADDRESS),
    input.irbClient.balanceOf(normalizedTokenOwner),
    input.provider.getBalance(TESTNET_ADMIN_ADDRESS),
    input.provider.getBalance(TESTNET_OPERATIONS_ADDRESS),
    input.provider.getBalance(normalizedTokenOwner),
    input.rewardClient.hasRole(defaultAdminRole, TESTNET_ADMIN_ADDRESS),
    input.rewardClient.hasRole(campaignManagerRole, TESTNET_ADMIN_ADDRESS),
    input.rewardClient.hasRole(campaignManagerRole, TESTNET_OPERATIONS_ADDRESS),
    input.rewardClient.hasRole(treasuryRole, TESTNET_ADMIN_ADDRESS),
    input.rewardClient.hasRole(approverRole, TESTNET_APPROVER_ADDRESS),
  ]);

  const oneRoundRequired = proposal.maxRewardAmount * BigInt(input.activeWalletCount);
  const totalRoundsRequired = oneRoundRequired * BigInt(proposal.rounds);
  const safetyBuffer =
    (proposal.budget * TEST_CAMPAIGN_SAFETY_BUFFER_BPS) / BPS_DENOMINATOR;
  const recommendedContractBalance = proposal.budget + safetyBuffer;
  const requiredTopUp = rewardContractIrb < recommendedContractBalance
    ? recommendedContractBalance - rewardContractIrb
    : 0n;
  const operationsTopUp = operationsTbnb < OPERATIONS_TBNB_TARGET
    ? OPERATIONS_TBNB_TARGET - operationsTbnb
    : 0n;
  const gasPriceWei = feeData.gasPrice;
  const transactions: PlannedCampaignTransaction[] = [];

  if (operationsTopUp > 0n) {
    const estimatedGas = await input.provider.estimateGas({
      from: TESTNET_ADMIN_ADDRESS,
      to: TESTNET_OPERATIONS_ADDRESS,
      value: operationsTopUp,
    });
    transactions.push({
      estimatedFeeWei: estimatedGas * gasPriceWei,
      estimatedGas,
      expectedStateChange: "Operations reaches the 0.001 tBNB campaign-gas target",
      function: "native tBNB transfer",
      kind: "TBNB_GAS_TOPUP",
      nativeValueWei: operationsTopUp,
      order: transactions.length + 1,
      requiredRole: null,
      sender: TESTNET_ADMIN_ADDRESS,
      senderSufficient: adminTbnb >= operationsTopUp + estimatedGas * gasPriceWei,
      to: TESTNET_OPERATIONS_ADDRESS,
    });
  }

  if (!campaign.exists && campaignManagerRoleHeldByOperations) {
    const createGas = await input.provider.estimateGas({
      data: rewardInterface.encodeFunctionData("createCampaign", [
        proposal.campaignId,
        proposal.budget,
        proposal.maxRewardAmount,
        proposal.startTime,
        proposal.endTime,
        proposal.claimInterval,
        proposal.active,
      ]),
      from: TESTNET_OPERATIONS_ADDRESS,
      to: AURIX_REWARD_CONTRACT_ADDRESS,
    });
    transactions.push({
      estimatedFeeWei: createGas * gasPriceWei,
      estimatedGas: createGas,
      expectedEvent: "CampaignCreated",
      expectedStateChange: "Creates the proposed active campaign with a delayed start",
      function: "createCampaign(bytes32,uint256,uint256,uint64,uint64,uint64,bool)",
      kind: "CAMPAIGN_CREATE",
      nativeValueWei: 0n,
      order: transactions.length + 1,
      requiredRole: "CAMPAIGN_MANAGER_ROLE",
      sender: TESTNET_OPERATIONS_ADDRESS,
      senderSufficient: operationsTbnb + operationsTopUp >= createGas * gasPriceWei,
      to: AURIX_REWARD_CONTRACT_ADDRESS,
    });
  }

  if (requiredTopUp > 0n && tokenOwnerIrb >= requiredTopUp) {
    const estimatedGas = await input.provider.estimateGas({
      data: tokenInterface.encodeFunctionData("transfer", [
        AURIX_REWARD_CONTRACT_ADDRESS,
        requiredTopUp,
      ]),
      from: normalizedTokenOwner,
      to: IRB_TEST_TOKEN_ADDRESS,
    });
    transactions.push({
      amountWei: requiredTopUp,
      estimatedFeeWei: estimatedGas * gasPriceWei,
      estimatedGas,
      expectedEvent: "Transfer",
      expectedStateChange: "Raises Reward Contract IRB to the recommended funded balance",
      function: "transfer(address,uint256)",
      kind: "IRB_TRANSFER",
      nativeValueWei: 0n,
      order: transactions.length + 1,
      requiredRole: null,
      sender: normalizedTokenOwner,
      senderSufficient: tokenOwnerTbnb >= estimatedGas * gasPriceWei,
      to: IRB_TEST_TOKEN_ADDRESS,
    });
  }

  const blockers: CampaignPlanBlocker[] = [];
  if (input.activeWalletCount !== DEFAULT_TEST_WALLET_COUNT) {
    blockers.push("ACTIVE_WALLET_COUNT_MISMATCH");
  }
  if (campaign.exists) blockers.push("CAMPAIGN_ALREADY_EXISTS");
  if (!campaignManagerRoleHeldByOperations) {
    blockers.push("OPERATIONS_MISSING_CAMPAIGN_MANAGER_ROLE");
  }
  if (tokenOwnerIrb < requiredTopUp) blockers.push("IRB_SOURCE_INSUFFICIENT");
  if (adminTbnb < operationsTopUp + (transactions[0]?.kind === "TBNB_GAS_TOPUP"
    ? transactions[0].estimatedFeeWei
    : 0n)) blockers.push("ADMIN_TBNB_INSUFFICIENT");
  const transfer = transactions.find((transaction) => transaction.kind === "IRB_TRANSFER");
  if (requiredTopUp > 0n && transfer && !transfer.senderSufficient) {
    blockers.push("IRB_SOURCE_GAS_INSUFFICIENT");
  }
  const create = transactions.find((transaction) => transaction.kind === "CAMPAIGN_CREATE");
  if (create && !create.senderSufficient) {
    blockers.push("OPERATIONS_TBNB_INSUFFICIENT_AFTER_TOPUP");
  }

  const totalEstimatedGas = transactions.reduce(
    (total, transaction) => total + transaction.estimatedGas,
    0n,
  );
  const totalEstimatedGasFeeWei = transactions.reduce(
    (total, transaction) => total + transaction.estimatedFeeWei,
    0n,
  );
  return {
    activeWalletCount: input.activeWalletCount,
    balances: {
      adminIrb,
      adminTbnb,
      approverIrb,
      operationsIrb,
      operationsTbnb,
      rewardContractIrb,
      tokenOwnerIrb,
      tokenOwnerTbnb,
    },
    blockNumber: block.number,
    blockers,
    campaignExists: campaign.exists,
    chainId,
    contractPaused,
    funding: {
      oneRoundRequired,
      recommendedContractBalance,
      requiredTopUp,
      safetyBuffer,
      totalRoundsRequired,
    },
    gasPriceWei,
    intervalBounds,
    proposal,
    proposalStatus: "RECOMMENDED_NOT_APPROVED",
    roles: {
      approverRole,
      approverRoleHeldByApprover,
      campaignManagerRole,
      campaignManagerRoleHeldByAdmin,
      campaignManagerRoleHeldByOperations,
      defaultAdminRole,
      defaultAdminRoleHeldByAdmin,
      treasuryRole,
      treasuryRoleHeldByAdmin,
    },
    status: blockers.length === 0 ? "READY_FOR_OWNER_REVIEW" : "BLOCKED",
    tokenOwner: normalizedTokenOwner,
    totalEstimatedGas,
    totalEstimatedGasFeeWei,
    transactions,
    transactionsSent: 0,
  };
}

export function emptyCampaign(): RewardCampaign {
  return {
    active: false,
    budget: 0n,
    claimInterval: 0n,
    distributed: 0n,
    endTime: 0n,
    exists: false,
    maxRewardAmount: 0n,
    startTime: 0n,
  };
}
