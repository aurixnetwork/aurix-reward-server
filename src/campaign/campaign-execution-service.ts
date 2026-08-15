import { createHash } from "node:crypto";

import {
  getAddress,
  keccak256,
  Wallet,
  type TransactionRequest,
} from "ethers";

import {
  AURIX_REWARD_CONTRACT_ADDRESS,
  BSC_TESTNET_CHAIN_ID,
  IRB_TEST_TOKEN_ADDRESS,
  TESTNET_ADMIN_ADDRESS,
  TESTNET_IRB_TOKEN_OWNER_ADDRESS,
  TESTNET_OPERATIONS_ADDRESS,
} from "../config/constants.js";
import {
  requireCampaignSigner,
  type CampaignExecutionEnvironmentConfig,
} from "../config/environment.js";
import { applyGasLimitSafetyMargin } from "../funding/funding-plan.js";
import type { RewardCampaign } from "../contracts/reward-contract-client.js";
import {
  campaignInterface,
  campaignMatchesApprovedBaseline,
  createCampaignExecutionPreflight,
  encodeCreateCampaign,
  irbTransferInterface,
  missingToTarget,
  OPERATIONS_TBNB_EXECUTION_TARGET,
  REWARD_CONTRACT_IRB_TARGET,
  TEST_CAMPAIGN_ID,
  type CampaignExecutionPreflight,
} from "./campaign-execution-plan.js";
import type {
  CampaignEvidenceRepository,
  CampaignExecutionProvider,
  CampaignOperationType,
  CampaignReader,
  CampaignReceipt,
  CampaignTransactionResponse,
  IrbReader,
} from "./campaign-execution-types.js";
import { createTestCampaignProposal } from "./campaign-plan.js";

export type CampaignStepStatus =
  | "CONFIRMED"
  | "SKIP_ALREADY_CREATED"
  | "SKIP_TARGET_REACHED"
  | "FAILED"
  | "PENDING_REVIEW"
  | "NOT_RUN";

export interface CampaignExecutionResult {
  readonly status: "COMPLETED" | "STOPPED_FAILED" | "STOPPED_PENDING_REVIEW";
  readonly steps: {
    readonly campaignCreate: CampaignStepStatus;
    readonly irbTransfer: CampaignStepStatus;
    readonly operationsTopUp: CampaignStepStatus;
  };
  readonly transactionsSent: number;
}

export interface ExecuteCampaignInput {
  readonly broadcastProviders: readonly CampaignExecutionProvider[];
  readonly config: CampaignExecutionEnvironmentConfig;
  readonly irbClient: IrbReader;
  readonly primaryProvider: CampaignExecutionProvider;
  readonly repository: CampaignEvidenceRepository;
  readonly rewardClient: CampaignReader;
  readonly preflight?: () => Promise<Pick<CampaignExecutionPreflight, "status">>;
}

export async function executeTestCampaignWorkflow(
  input: ExecuteCampaignInput,
): Promise<CampaignExecutionResult> {
  if (!input.config.executionEnabled) {
    throw new Error(
      "Campaign execution is disabled; set CAMPAIGN_EXECUTION_ENABLED=true only for the owner-reviewed command",
    );
  }
  const unresolved = await input.repository.listUnresolved();
  if (unresolved.length > 0) {
    throw new Error("Campaign execution has unresolved transaction evidence; reconcile before continuing");
  }
  const preflight = input.preflight
    ? await input.preflight()
    : await createCampaignExecutionPreflight({
        campaignConfig: input.config,
        irbClient: input.irbClient,
        provider: input.primaryProvider,
        rewardClient: input.rewardClient,
      });
  if (preflight.status === "BLOCKED") {
    throw new Error("Campaign execution preflight is blocked; no transactions sent");
  }

  let transactionsSent = 0;
  let operationsTopUp: CampaignStepStatus;
  let campaignCreate: CampaignStepStatus = "NOT_RUN";
  let irbTransfer: CampaignStepStatus = "NOT_RUN";

  const operationsBalance = await input.primaryProvider.getBalance(TESTNET_OPERATIONS_ADDRESS);
  const topUpAmount = missingToTarget(operationsBalance, OPERATIONS_TBNB_EXECUTION_TARGET);
  if (topUpAmount === 0n) {
    operationsTopUp = "SKIP_TARGET_REACHED";
  } else {
    const fee = await executableFee(input, {
      from: TESTNET_ADMIN_ADDRESS,
      to: input.config.operationsExpectedAddress,
      value: topUpAmount,
    });
    const adminBalance = await input.primaryProvider.getBalance(TESTNET_ADMIN_ADDRESS);
    if (adminBalance < topUpAmount + fee.gasLimit * fee.gasPriceWei) {
      throw new Error("Admin tBNB balance is insufficient for Operations target top-up");
    }
    const admin = requireCampaignSigner(input.config, "ADMIN");
    const topUp = await runSignedOperation(input, {
      amountWei: topUpAmount,
      calldata: "0x",
      gasLimit: fee.gasLimit,
      gasPriceWei: fee.gasPriceWei,
      operationType: "TBNB_GAS_TOPUP",
      payload: {
        targetBalanceWei: OPERATIONS_TBNB_EXECUTION_TARGET.toString(),
        valueWei: topUpAmount.toString(),
      },
      signer: new Wallet(admin.privateKey),
      to: input.config.operationsExpectedAddress,
      valueWei: topUpAmount,
      validate: async () =>
        await input.primaryProvider.getBalance(input.config.operationsExpectedAddress) >=
          operationsBalance + topUpAmount,
    });
    transactionsSent += topUp.transactionAccepted ? 1 : 0;
    operationsTopUp = topUp.status;
    if (topUp.status !== "CONFIRMED") {
      return stopped(topUp.status, { campaignCreate, irbTransfer, operationsTopUp }, transactionsSent);
    }
  }

  const existingCampaign = await input.rewardClient.getCampaign(TEST_CAMPAIGN_ID);
  if (existingCampaign.exists) {
    if (!campaignMatchesApprovedBaseline(existingCampaign)) {
      throw new Error("Existing Test Campaign parameters differ from the approved baseline; owner review required");
    }
    campaignCreate = "SKIP_ALREADY_CREATED";
  } else {
    const role = await input.rewardClient.getRoleId("CAMPAIGN_MANAGER_ROLE");
    if (!await input.rewardClient.hasRole(role, input.config.operationsExpectedAddress)) {
      throw new Error("Operations does not hold CAMPAIGN_MANAGER_ROLE");
    }
    const latestBlock = await input.primaryProvider.getBlock("latest");
    if (!latestBlock) throw new Error("RPC did not return the latest execution block");
    const proposal = createTestCampaignProposal(latestBlock.timestamp);
    const calldata = encodeCreateCampaign(proposal);
    const fee = await executableFee(input, {
      data: calldata,
      from: input.config.operationsExpectedAddress,
      to: AURIX_REWARD_CONTRACT_ADDRESS,
    });
    if (await input.primaryProvider.getBalance(input.config.operationsExpectedAddress) <
        fee.gasLimit * fee.gasPriceWei) {
      throw new Error("Operations tBNB balance is insufficient for createCampaign");
    }
    const operations = requireCampaignSigner(input.config, "OPERATIONS");
    const create = await runSignedOperation(input, {
      amountWei: 0n,
      calldata,
      gasLimit: fee.gasLimit,
      gasPriceWei: fee.gasPriceWei,
      operationType: "CAMPAIGN_CREATE",
      payload: publicProposal(proposal),
      signer: new Wallet(operations.privateKey),
      to: AURIX_REWARD_CONTRACT_ADDRESS,
      valueWei: 0n,
      validate: async (receipt) =>
        validateCampaignCreated(receipt, proposal) &&
        campaignExactlyEquals(await input.rewardClient.getCampaign(TEST_CAMPAIGN_ID), proposal),
    });
    transactionsSent += create.transactionAccepted ? 1 : 0;
    campaignCreate = create.status;
    if (create.status !== "CONFIRMED") {
      return stopped(create.status, { campaignCreate, irbTransfer, operationsTopUp }, transactionsSent);
    }
  }

  const contractBalance = await input.irbClient.balanceOf(AURIX_REWARD_CONTRACT_ADDRESS);
  const transferAmount = missingToTarget(contractBalance, REWARD_CONTRACT_IRB_TARGET);
  if (transferAmount === 0n) {
    irbTransfer = "SKIP_TARGET_REACHED";
  } else {
    const owner = getAddress(await input.irbClient.owner());
    if (owner !== getAddress(TESTNET_IRB_TOKEN_OWNER_ADDRESS)) {
      throw new Error("Configured IRB Token Owner is not the current on-chain token owner");
    }
    if (await input.irbClient.balanceOf(owner) < transferAmount) {
      throw new Error("IRB Token Owner balance is insufficient for target inventory");
    }
    const calldata = irbTransferInterface.encodeFunctionData("transfer", [
      AURIX_REWARD_CONTRACT_ADDRESS,
      transferAmount,
    ]);
    const fee = await executableFee(input, {
      data: calldata,
      from: owner,
      to: IRB_TEST_TOKEN_ADDRESS,
    });
    if (await input.primaryProvider.getBalance(owner) < fee.gasLimit * fee.gasPriceWei) {
      throw new Error("IRB Token Owner tBNB balance is insufficient for transfer gas");
    }
    const tokenOwnerSigner = requireCampaignSigner(input.config, "IRB_TOKEN_OWNER");
    const transfer = await runSignedOperation(input, {
      amountWei: transferAmount,
      calldata,
      gasLimit: fee.gasLimit,
      gasPriceWei: fee.gasPriceWei,
      operationType: "IRB_TRANSFER",
      payload: {
        amountBaseUnits: transferAmount.toString(),
        inventoryTargetBaseUnits: REWARD_CONTRACT_IRB_TARGET.toString(),
        recipient: AURIX_REWARD_CONTRACT_ADDRESS,
      },
      signer: new Wallet(tokenOwnerSigner.privateKey),
      to: IRB_TEST_TOKEN_ADDRESS,
      valueWei: 0n,
      validate: async (receipt) =>
        validateTransfer(receipt, owner, transferAmount) &&
        await input.irbClient.balanceOf(AURIX_REWARD_CONTRACT_ADDRESS) >=
          REWARD_CONTRACT_IRB_TARGET,
    });
    transactionsSent += transfer.transactionAccepted ? 1 : 0;
    irbTransfer = transfer.status;
    if (transfer.status !== "CONFIRMED") {
      return stopped(transfer.status, { campaignCreate, irbTransfer, operationsTopUp }, transactionsSent);
    }
  }

  return {
    status: "COMPLETED",
    steps: { campaignCreate, irbTransfer, operationsTopUp },
    transactionsSent,
  };
}

interface SignedOperation {
  readonly amountWei: bigint;
  readonly calldata: string;
  readonly gasLimit: bigint;
  readonly gasPriceWei: bigint;
  readonly operationType: CampaignOperationType;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly signer: Wallet;
  readonly to: string;
  readonly validate: (receipt: CampaignReceipt) => Promise<boolean>;
  readonly valueWei: bigint;
}

async function runSignedOperation(
  input: ExecuteCampaignInput,
  operation: SignedOperation,
): Promise<{ readonly status: "CONFIRMED" | "FAILED" | "PENDING_REVIEW"; readonly transactionAccepted: boolean }> {
  const nonce = await input.primaryProvider.getTransactionCount(operation.signer.address, "pending");
  const transaction: TransactionRequest = {
    chainId: BSC_TESTNET_CHAIN_ID,
    data: operation.calldata,
    gasLimit: operation.gasLimit,
    gasPrice: operation.gasPriceWei,
    nonce,
    to: operation.to,
    type: 0,
    value: operation.valueWei,
  };
  const rawTransaction = await operation.signer.signTransaction(transaction);
  const signedTxHash = keccak256(rawTransaction);
  const operationId = createOperationId(
    operation.operationType,
    operation.signer.address,
    nonce,
    signedTxHash,
  );
  await input.repository.insertSigned({
    amountWei: operation.amountWei,
    calldataHash: keccak256(operation.calldata),
    expectedSender: operation.signer.address,
    gasLimit: operation.gasLimit,
    gasPriceWei: operation.gasPriceWei,
    operationId,
    operationType: operation.operationType,
    payload: operation.payload,
    signedTxHash,
    txNonce: nonce,
  });

  let response: CampaignTransactionResponse | undefined;
  for (const provider of input.broadcastProviders) {
    try {
      const candidate = await provider.broadcastTransaction(rawTransaction);
      if (candidate.hash.toLowerCase() !== signedTxHash.toLowerCase()) continue;
      response = candidate;
      break;
    } catch { /* rebroadcast only the identical signed bytes */ }
  }
  if (!response) {
    await input.repository.markPendingReview(operationId, "BROADCAST_UNCERTAIN");
    return { status: "PENDING_REVIEW", transactionAccepted: false };
  }
  await input.repository.markBroadcast(operationId, response.hash);
  let receipt: CampaignReceipt | null;
  try {
    receipt = await response.wait(1);
  } catch {
    await input.repository.markPendingReview(operationId, "RECEIPT_TIMEOUT");
    return { status: "PENDING_REVIEW", transactionAccepted: true };
  }
  if (!receipt) {
    await input.repository.markPendingReview(operationId, "RECEIPT_PENDING");
    return { status: "PENDING_REVIEW", transactionAccepted: true };
  }
  if (receipt.status !== 1) {
    await input.repository.markFailed(operationId, "TRANSACTION_REVERTED", receipt);
    return { status: "FAILED", transactionAccepted: true };
  }
  if (!await operation.validate(receipt)) {
    await input.repository.markPendingReview(operationId, "FINAL_STATE_VALIDATION_FAILED");
    return { status: "PENDING_REVIEW", transactionAccepted: true };
  }
  await input.repository.markConfirmed(operationId, receipt);
  return { status: "CONFIRMED", transactionAccepted: true };
}

async function executableFee(
  input: ExecuteCampaignInput,
  request: TransactionRequest,
): Promise<{ readonly gasLimit: bigint; readonly gasPriceWei: bigint }> {
  const [network, feeData, estimatedGas] = await Promise.all([
    input.primaryProvider.getNetwork(),
    input.primaryProvider.getFeeData(),
    input.primaryProvider.estimateGas(request),
  ]);
  if (Number(network.chainId) !== BSC_TESTNET_CHAIN_ID) {
    throw new Error("Campaign execution is restricted to BSC Testnet chain ID 97");
  }
  if (feeData.gasPrice === null || feeData.gasPrice <= 0n) {
    throw new Error("RPC did not return a usable legacy gas price");
  }
  if (input.config.maxGasPriceWei !== undefined &&
      feeData.gasPrice > input.config.maxGasPriceWei) {
    throw new Error("Observed gas price exceeds MAX_CAMPAIGN_GAS_PRICE_GWEI");
  }
  return { gasLimit: applyGasLimitSafetyMargin(estimatedGas), gasPriceWei: feeData.gasPrice };
}

export function validateCampaignCreated(
  receipt: CampaignReceipt,
  proposal: ReturnType<typeof createTestCampaignProposal>,
): boolean {
  return receipt.logs.some((log) => {
    if (getAddress(log.address) !== getAddress(AURIX_REWARD_CONTRACT_ADDRESS)) return false;
    try {
      const parsed = campaignInterface.parseLog({ data: log.data, topics: [...log.topics] });
      return parsed?.name === "CampaignCreated" &&
        parsed.args[0] === proposal.campaignId &&
        parsed.args[1] === proposal.budget &&
        parsed.args[2] === proposal.maxRewardAmount &&
        parsed.args[3] === proposal.startTime &&
        parsed.args[4] === proposal.endTime &&
        parsed.args[5] === proposal.claimInterval &&
        parsed.args[6] === proposal.active;
    } catch { return false; }
  });
}

export function validateTransfer(
  receipt: CampaignReceipt,
  owner: string,
  amount: bigint,
): boolean {
  return receipt.logs.some((log) => {
    if (getAddress(log.address) !== getAddress(IRB_TEST_TOKEN_ADDRESS)) return false;
    try {
      const parsed = irbTransferInterface.parseLog({ data: log.data, topics: [...log.topics] });
      return parsed?.name === "Transfer" &&
        getAddress(parsed.args[0] as string) === getAddress(owner) &&
        getAddress(parsed.args[1] as string) === getAddress(AURIX_REWARD_CONTRACT_ADDRESS) &&
        parsed.args[2] === amount;
    } catch { return false; }
  });
}

function campaignExactlyEquals(
  campaign: RewardCampaign,
  proposal: ReturnType<typeof createTestCampaignProposal>,
): boolean {
  return campaign.exists && campaign.distributed === 0n &&
    campaign.active === proposal.active && campaign.budget === proposal.budget &&
    campaign.maxRewardAmount === proposal.maxRewardAmount &&
    campaign.startTime === proposal.startTime && campaign.endTime === proposal.endTime &&
    campaign.claimInterval === proposal.claimInterval;
}

function publicProposal(proposal: ReturnType<typeof createTestCampaignProposal>): Record<string, unknown> {
  return {
    active: proposal.active,
    budgetBaseUnits: proposal.budget.toString(),
    campaignId: proposal.campaignId,
    claimIntervalSeconds: proposal.claimInterval.toString(),
    endTime: proposal.endTime.toString(),
    maxRewardAmountBaseUnits: proposal.maxRewardAmount.toString(),
    startTime: proposal.startTime.toString(),
  };
}

function createOperationId(
  type: CampaignOperationType,
  sender: string,
  nonce: number,
  signedTxHash: string,
): string {
  return createHash("sha256")
    .update([BSC_TESTNET_CHAIN_ID, TEST_CAMPAIGN_ID, type, sender, nonce, signedTxHash].join("|"))
    .digest("hex");
}

function stopped(
  stepStatus: "FAILED" | "PENDING_REVIEW",
  steps: CampaignExecutionResult["steps"],
  transactionsSent: number,
): CampaignExecutionResult {
  return {
    status: stepStatus === "FAILED" ? "STOPPED_FAILED" : "STOPPED_PENDING_REVIEW",
    steps,
    transactionsSent,
  };
}
