import {
  getAddress,
  Interface,
  parseEther,
  parseUnits,
  Wallet,
  type TransactionRequest,
} from "ethers";

import rewardContractAbi from "../contracts/abi/AurixRewardClaim.json" with { type: "json" };
import {
  AURIX_REWARD_CONTRACT_ADDRESS,
  BSC_TESTNET_CHAIN_ID,
  IRB_TEST_TOKEN_ADDRESS,
  TESTNET_ADMIN_ADDRESS,
  TESTNET_IRB_TOKEN_OWNER_ADDRESS,
  TESTNET_OPERATIONS_ADDRESS,
} from "../config/constants.js";
import type { CampaignExecutionEnvironmentConfig } from "../config/environment.js";
import { applyGasLimitSafetyMargin } from "../funding/funding-plan.js";
import {
  createTestCampaignProposal,
  TEST_CAMPAIGN_DURATION_SECONDS,
  validateCampaignProposal,
  type TestCampaignProposal,
} from "./campaign-plan.js";
import type {
  CampaignExecutionProvider,
  CampaignOperationType,
  CampaignReader,
  IrbReader,
} from "./campaign-execution-types.js";
import type { RewardCampaign } from "../contracts/reward-contract-client.js";

export const TEST_CAMPAIGN_ID =
  "0x8509292576353d7b1173acb5a1a30074fecb8972df178c423389f95b3be2daac";
export const TEST_CAMPAIGN_BUDGET = parseUnits("3", 18);
export const TEST_CAMPAIGN_MAX_REWARD = parseUnits("0.1", 18);
export const REWARD_CONTRACT_IRB_TARGET = parseUnits("3.3", 18);
export const OPERATIONS_TBNB_EXECUTION_TARGET = parseEther("0.001");

export const campaignInterface = new Interface(rewardContractAbi);
export const irbTransferInterface = new Interface([
  "function transfer(address recipient, uint256 amount) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

export interface CampaignSignerCheck {
  readonly configured: boolean;
  readonly expectedAddress: string;
  readonly matches: boolean;
  readonly role: "ADMIN" | "IRB_TOKEN_OWNER" | "OPERATIONS";
}

export interface CampaignPreflightCheck {
  readonly name: string;
  readonly passed: boolean;
}

export interface CampaignPlannedTransaction {
  readonly amountWei: bigint;
  readonly calldata: string;
  readonly estimatedFeeWei: bigint;
  readonly estimatedGas: bigint;
  readonly gasLimit: bigint;
  readonly kind: CampaignOperationType;
  readonly order: 1 | 2 | 3;
  readonly sender: string;
  readonly to: string;
  readonly valueWei: bigint;
}

export interface CampaignExecutionPreflight {
  readonly balances: {
    readonly adminTbnb: bigint;
    readonly operationsTbnb: bigint;
    readonly rewardContractIrb: bigint;
    readonly tokenOwnerIrb: bigint;
    readonly tokenOwnerTbnb: bigint;
  };
  readonly blockNumber: number;
  readonly campaign: RewardCampaign;
  readonly campaignAction: "CREATE_REQUIRED" | "SKIP_ALREADY_CREATED" | "STOP_MISMATCH";
  readonly checks: readonly CampaignPreflightCheck[];
  readonly contractPaused: boolean;
  readonly gasPriceWei: bigint;
  readonly gasPriceWithinMaximum: boolean;
  readonly operationsTopUpWei: bigint;
  readonly proposal: TestCampaignProposal;
  readonly requiredIrbTransfer: bigint;
  readonly signers: readonly CampaignSignerCheck[];
  readonly status: "BLOCKED" | "READY_FOR_OWNER_EXECUTION" | "SKIP_ALREADY_CREATED";
  readonly tokenOwner: string;
  readonly transactions: readonly CampaignPlannedTransaction[];
  readonly transactionsSent: 0;
}

export interface CreateCampaignExecutionPreflightInput {
  readonly campaignConfig: CampaignExecutionEnvironmentConfig;
  readonly irbClient: IrbReader;
  readonly provider: CampaignExecutionProvider;
  readonly rewardClient: CampaignReader;
}

export async function createCampaignExecutionPreflight(
  input: CreateCampaignExecutionPreflightInput,
): Promise<CampaignExecutionPreflight> {
  const [network, block, feeData, rewardCode, irbCode] = await Promise.all([
    input.provider.getNetwork(),
    input.provider.getBlock("latest"),
    input.provider.getFeeData(),
    input.provider.getCode(AURIX_REWARD_CONTRACT_ADDRESS),
    input.provider.getCode(IRB_TEST_TOKEN_ADDRESS),
  ]);
  if (!block) throw new Error("RPC did not return the latest block");
  if (feeData.gasPrice === null || feeData.gasPrice <= 0n) {
    throw new Error("RPC did not return a usable legacy gas price");
  }

  const proposal = createTestCampaignProposal(block.timestamp);
  if (proposal.campaignId !== TEST_CAMPAIGN_ID || proposal.budget !== TEST_CAMPAIGN_BUDGET ||
      proposal.maxRewardAmount !== TEST_CAMPAIGN_MAX_REWARD) {
    throw new Error("Compiled Test Campaign constants differ from the approved baseline");
  }
  const intervalBounds = await input.rewardClient.getClaimIntervalBounds();
  validateCampaignProposal(proposal, intervalBounds);

  const campaignManagerRole = await input.rewardClient.getRoleId("CAMPAIGN_MANAGER_ROLE");
  const [campaign, paused, hasRole, tokenOwner, adminTbnb, operationsTbnb,
    tokenOwnerTbnb, tokenOwnerIrb, rewardContractIrb] = await Promise.all([
    input.rewardClient.getCampaign(TEST_CAMPAIGN_ID),
    input.rewardClient.isPaused(),
    input.rewardClient.hasRole(campaignManagerRole, TESTNET_OPERATIONS_ADDRESS),
    input.irbClient.owner(),
    input.provider.getBalance(TESTNET_ADMIN_ADDRESS),
    input.provider.getBalance(TESTNET_OPERATIONS_ADDRESS),
    input.provider.getBalance(TESTNET_IRB_TOKEN_OWNER_ADDRESS),
    input.irbClient.balanceOf(TESTNET_IRB_TOKEN_OWNER_ADDRESS),
    input.irbClient.balanceOf(AURIX_REWARD_CONTRACT_ADDRESS),
  ]);
  const normalizedTokenOwner = getAddress(tokenOwner);
  const operationsTopUpWei = missingToTarget(operationsTbnb, OPERATIONS_TBNB_EXECUTION_TARGET);
  const requiredIrbTransfer = missingToTarget(rewardContractIrb, REWARD_CONTRACT_IRB_TARGET);
  const campaignAction = !campaign.exists
    ? "CREATE_REQUIRED"
    : campaignMatchesApprovedBaseline(campaign)
      ? "SKIP_ALREADY_CREATED"
      : "STOP_MISMATCH";
  const signers = signerChecks(input.campaignConfig);
  const gasPriceWei = feeData.gasPrice;
  const gasPriceWithinMaximum = input.campaignConfig.maxGasPriceWei === undefined ||
    gasPriceWei <= input.campaignConfig.maxGasPriceWei;
  const transactions: CampaignPlannedTransaction[] = [];

  if (operationsTopUpWei > 0n) {
    transactions.push(await planTransaction(input.provider, gasPriceWei, {
      amountWei: operationsTopUpWei,
      calldata: "0x",
      kind: "TBNB_GAS_TOPUP",
      order: 1,
      sender: TESTNET_ADMIN_ADDRESS,
      to: TESTNET_OPERATIONS_ADDRESS,
      valueWei: operationsTopUpWei,
    }));
  }
  if (campaignAction === "CREATE_REQUIRED" && hasRole) {
    const calldata = encodeCreateCampaign(proposal);
    transactions.push(await planTransaction(input.provider, gasPriceWei, {
      amountWei: 0n,
      calldata,
      kind: "CAMPAIGN_CREATE",
      order: 2,
      sender: TESTNET_OPERATIONS_ADDRESS,
      to: AURIX_REWARD_CONTRACT_ADDRESS,
      valueWei: 0n,
    }));
  }
  if (requiredIrbTransfer > 0n && tokenOwnerIrb >= requiredIrbTransfer &&
      normalizedTokenOwner === getAddress(TESTNET_IRB_TOKEN_OWNER_ADDRESS)) {
    const calldata = irbTransferInterface.encodeFunctionData("transfer", [
      AURIX_REWARD_CONTRACT_ADDRESS,
      requiredIrbTransfer,
    ]);
    transactions.push(await planTransaction(input.provider, gasPriceWei, {
      amountWei: requiredIrbTransfer,
      calldata,
      kind: "IRB_TRANSFER",
      order: 3,
      sender: TESTNET_IRB_TOKEN_OWNER_ADDRESS,
      to: IRB_TEST_TOKEN_ADDRESS,
      valueWei: 0n,
    }));
  }

  const topUp = transactions.find((transaction) => transaction.kind === "TBNB_GAS_TOPUP");
  const create = transactions.find((transaction) => transaction.kind === "CAMPAIGN_CREATE");
  const transfer = transactions.find((transaction) => transaction.kind === "IRB_TRANSFER");
  const checks: CampaignPreflightCheck[] = [
    { name: "chain_id_97", passed: Number(network.chainId) === BSC_TESTNET_CHAIN_ID },
    { name: "reward_contract_bytecode", passed: rewardCode !== "0x" },
    { name: "irb_token_bytecode", passed: irbCode !== "0x" },
    { name: "campaign_not_mismatched", passed: campaignAction !== "STOP_MISMATCH" },
    { name: "operations_campaign_manager_role", passed: hasRole },
    { name: "admin_key_address", passed: signers[0]?.matches === true },
    { name: "operations_key_address", passed: signers[1]?.matches === true },
    { name: "irb_token_owner_key_address", passed: signers[2]?.matches === true },
    { name: "irb_owner_on_chain", passed: normalizedTokenOwner === getAddress(TESTNET_IRB_TOKEN_OWNER_ADDRESS) },
    { name: "admin_tbnb", passed: operationsTopUpWei === 0n ||
      adminTbnb >= operationsTopUpWei + (topUp?.estimatedFeeWei ?? 0n) },
    { name: "operations_tbnb_after_topup", passed: campaignAction !== "CREATE_REQUIRED" ||
      operationsTbnb + operationsTopUpWei >= (create?.estimatedFeeWei ?? 0n) },
    { name: "token_owner_tbnb", passed: requiredIrbTransfer === 0n ||
      (transfer !== undefined && tokenOwnerTbnb >= transfer.estimatedFeeWei) },
    { name: "token_owner_irb", passed: tokenOwnerIrb >= requiredIrbTransfer },
    { name: "campaign_parameters", passed: true },
    { name: "gas_price_maximum", passed: gasPriceWithinMaximum },
  ];
  const ready = checks.every((check) => check.passed);
  return {
    balances: { adminTbnb, operationsTbnb, rewardContractIrb, tokenOwnerIrb, tokenOwnerTbnb },
    blockNumber: block.number,
    campaign,
    campaignAction,
    checks,
    contractPaused: paused,
    gasPriceWei,
    gasPriceWithinMaximum,
    operationsTopUpWei,
    proposal,
    requiredIrbTransfer,
    signers,
    status: ready
      ? campaignAction === "SKIP_ALREADY_CREATED" ? "SKIP_ALREADY_CREATED" : "READY_FOR_OWNER_EXECUTION"
      : "BLOCKED",
    tokenOwner: normalizedTokenOwner,
    transactions,
    transactionsSent: 0,
  };
}

export function missingToTarget(current: bigint, target: bigint): bigint {
  return current < target ? target - current : 0n;
}

export function campaignMatchesApprovedBaseline(campaign: RewardCampaign): boolean {
  return campaign.exists &&
    campaign.budget === TEST_CAMPAIGN_BUDGET &&
    campaign.maxRewardAmount === TEST_CAMPAIGN_MAX_REWARD &&
    campaign.claimInterval === 3_600n &&
    campaign.active &&
    campaign.startTime > 0n &&
    campaign.endTime - campaign.startTime === TEST_CAMPAIGN_DURATION_SECONDS &&
    campaign.distributed <= campaign.budget;
}

export function encodeCreateCampaign(proposal: TestCampaignProposal): string {
  return campaignInterface.encodeFunctionData("createCampaign", [
    proposal.campaignId,
    proposal.budget,
    proposal.maxRewardAmount,
    proposal.startTime,
    proposal.endTime,
    proposal.claimInterval,
    proposal.active,
  ]);
}

function signerChecks(config: CampaignExecutionEnvironmentConfig): CampaignSignerCheck[] {
  return [
    signerCheck("ADMIN", config.adminPrivateKey, TESTNET_ADMIN_ADDRESS),
    signerCheck("OPERATIONS", config.operationsPrivateKey, config.operationsExpectedAddress),
    signerCheck("IRB_TOKEN_OWNER", config.irbTokenOwnerPrivateKey,
      config.irbTokenOwnerExpectedAddress),
  ];
}

function signerCheck(
  role: CampaignSignerCheck["role"],
  privateKey: string | undefined,
  expectedAddress: string,
): CampaignSignerCheck {
  let matches = false;
  if (privateKey) {
    try {
      matches = new Wallet(privateKey).address === getAddress(expectedAddress);
    } catch { /* malformed keys are rejected by environment validation */ }
  }
  return { configured: privateKey !== undefined, expectedAddress: getAddress(expectedAddress), matches, role };
}

async function planTransaction(
  provider: CampaignExecutionProvider,
  gasPriceWei: bigint,
  transaction: Omit<CampaignPlannedTransaction, "estimatedFeeWei" | "estimatedGas" | "gasLimit">,
): Promise<CampaignPlannedTransaction> {
  const request: TransactionRequest = {
    data: transaction.calldata,
    from: transaction.sender,
    to: transaction.to,
    value: transaction.valueWei,
  };
  const estimatedGas = await provider.estimateGas(request);
  const gasLimit = applyGasLimitSafetyMargin(estimatedGas);
  return {
    ...transaction,
    estimatedFeeWei: gasLimit * gasPriceWei,
    estimatedGas,
    gasLimit,
  };
}
