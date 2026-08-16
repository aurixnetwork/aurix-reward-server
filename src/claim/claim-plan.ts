import { getAddress } from "ethers";

import type { AuthorizationJobRecord } from "../authorization/authorization-types.js";
import {
  hashRewardAuthorization,
  recoverRewardAuthorizationSigner,
  validateRewardAuthorization,
} from "../authorization/eip712.js";
import { BASIS_POINTS, BSC_TESTNET_CHAIN_ID, CLAIM_GAS_LIMIT_SAFETY_BPS } from "../config/constants.js";
import type { PublicWalletRecord } from "../wallets/wallet-types.js";
import { encodeClaimReward } from "./claim-codec.js";
import type {
  ClaimBlocker,
  ClaimChainReader,
  ClaimExpectedAction,
  ClaimJobRecord,
  ClaimPlan,
  ClaimProvider,
  ClaimTokenReader,
} from "./claim-types.js";

export interface BuildClaimPlanInput {
  readonly authorization: AuthorizationJobRecord;
  readonly existingJob?: ClaimJobRecord;
  readonly expectedApprover: string;
  readonly irbTokenAddress: string;
  readonly maxGasPriceWei?: bigint;
  readonly provider: ClaimProvider;
  readonly reader: ClaimChainReader;
  readonly rewardContractAddress: string;
  readonly token: ClaimTokenReader;
  readonly wallet?: PublicWalletRecord;
}

export async function buildClaimPlan(input: BuildClaimPlanInput): Promise<ClaimPlan> {
  const blockers: ClaimBlocker[] = [];
  const authorization = input.authorization;
  const claimant = getAddress(authorization.claimant);
  let expectedAction: ClaimExpectedAction = "SIGN_AND_BROADCAST";

  if (input.existingJob) {
    if (input.existingJob.status === "CONFIRMED") {
      expectedAction = "SKIP_ALREADY_CONFIRMED";
    } else if (["SIGNED", "BROADCAST", "PENDING_REVIEW"].includes(input.existingJob.status)) {
      expectedAction = "RECONCILE_EXISTING";
    } else {
      expectedAction = "BLOCKED";
      add(blockers, "BLOCKED_EXISTING_CLAIM_JOB", "A claim job already exists and requires operator review");
    }
  }

  if (!input.wallet) {
    add(blockers, "BLOCKED_USER_WALLET_NOT_FOUND", "Authorization User Wallet was not found");
  } else {
    if (input.wallet.status !== "ACTIVE") {
      add(blockers, "BLOCKED_USER_WALLET_INACTIVE", "User Wallet is not ACTIVE");
    }
    if (
      input.wallet.id !== authorization.walletId ||
      getAddress(input.wallet.walletAddress) !== claimant
    ) {
      add(blockers, "BLOCKED_CLAIMANT_MISMATCH", "Authorization claimant does not match its stored User Wallet");
    }
  }

  if (authorization.status !== "READY") {
    const confirmedPair = authorization.status === "CONSUMED" && expectedAction === "SKIP_ALREADY_CONFIRMED";
    if (!confirmedPair) {
      add(blockers, "BLOCKED_AUTHORIZATION_NOT_READY", "Authorization status must be READY");
    }
  }

  const [network, latestBlock, rewardCode, irbCode, paused, rewardToken, campaign,
    rewardIdUsed, userGasBalanceWei, irbBalance, rewardContractIrbBalance,
    feeData, currentEthereumTxNonce] = await Promise.all([
    input.provider.getNetwork(),
    input.provider.getBlock("latest"),
    input.provider.getCode(input.rewardContractAddress),
    input.provider.getCode(input.irbTokenAddress),
    input.reader.isPaused(),
    input.reader.getRewardToken(),
    input.reader.getCampaign(authorization.campaignId),
    input.reader.isRewardIdUsed(authorization.rewardId),
    input.provider.getBalance(claimant),
    input.token.balanceOf(claimant),
    input.token.balanceOf(input.rewardContractAddress),
    input.provider.getFeeData(),
    input.provider.getTransactionCount(claimant, "pending"),
  ]);

  if (!latestBlock) throw new Error("Latest BSC Testnet block was unavailable");
  const now = BigInt(latestBlock.timestamp);
  if (Number(network.chainId) !== BSC_TESTNET_CHAIN_ID) {
    add(blockers, "BLOCKED_WRONG_CHAIN", "RPC chain ID is not BSC Testnet 97");
  }
  if (rewardCode === "0x") {
    add(blockers, "BLOCKED_REWARD_CONTRACT_CODE_MISSING", "Reward Contract bytecode is missing");
  }
  if (irbCode === "0x") {
    add(blockers, "BLOCKED_IRB_CODE_MISSING", "IRB bytecode is missing");
  }
  if (getAddress(rewardToken) !== getAddress(input.irbTokenAddress)) {
    add(blockers, "BLOCKED_REWARD_TOKEN_MISMATCH", "Reward Contract rewardToken does not match fixed IRB");
  }
  if (paused) add(blockers, "BLOCKED_CONTRACT_PAUSED", "Reward Contract is paused");
  if (!campaign.exists) add(blockers, "BLOCKED_CAMPAIGN_NOT_FOUND", "Campaign does not exist");
  if (!campaign.active) add(blockers, "BLOCKED_CAMPAIGN_INACTIVE", "Campaign is inactive");
  if (now < campaign.startTime) add(blockers, "BLOCKED_CAMPAIGN_NOT_STARTED", "Campaign has not started");
  if (now > campaign.endTime) add(blockers, "BLOCKED_CAMPAIGN_ENDED", "Campaign has ended");
  if (authorization.amount <= 0n) add(blockers, "BLOCKED_ZERO_AMOUNT", "Reward amount must be positive");
  if (authorization.amount > campaign.maxRewardAmount) {
    add(blockers, "BLOCKED_AMOUNT_EXCEEDS_MAX", "Reward amount exceeds campaign maxRewardAmount");
  }
  if (campaign.distributed > campaign.budget || authorization.amount > campaign.budget - campaign.distributed) {
    add(blockers, "BLOCKED_CAMPAIGN_BUDGET", "Campaign remaining budget is insufficient");
  }
  if (rewardContractIrbBalance < authorization.amount) {
    add(blockers, "BLOCKED_REWARD_CONTRACT_IRB", "Reward Contract IRB balance is insufficient");
  }
  if (authorization.validAfter > now) {
    add(blockers, "BLOCKED_AUTHORIZATION_NOT_YET_VALID", "Authorization validAfter has not been reached");
  }
  if (now > authorization.deadline) {
    add(blockers, "BLOCKED_AUTHORIZATION_EXPIRED", "Authorization deadline has passed");
  }
  if (rewardIdUsed) {
    add(blockers, "BLOCKED_REWARD_ID_USED", "rewardId is already consumed on-chain");
    if (expectedAction === "SIGN_AND_BROADCAST") expectedAction = "RECONCILE_REWARD_ALREADY_USED";
  }

  const claimantState = campaign.exists
    ? await input.reader.getClaimantState(authorization.campaignId, claimant)
    : undefined;
  if (claimantState) {
    if (claimantState.rewardNonce !== authorization.rewardNonce) {
      add(blockers, "BLOCKED_STALE_REWARD_NONCE", "Current contract rewardNonce does not match the authorization");
    }
    if (!claimantState.claimIntervalElapsed || claimantState.nextClaimAt > now) {
      add(blockers, "BLOCKED_CLAIM_INTERVAL", "Campaign claim interval has not elapsed");
    }
  }

  let recoveredApprover: string | undefined;
  try {
    validateRewardAuthorization(authorizationFromJob(authorization));
    const calculatedHash = hashRewardAuthorization(authorizationFromJob(authorization));
    if (!authorization.typedDataHash || calculatedHash.toLowerCase() !== authorization.typedDataHash.toLowerCase()) {
      add(blockers, "BLOCKED_INVALID_AUTHORIZATION_HASH", "Persisted EIP-712 hash does not match canonical authorization fields");
    }
    if (!authorization.approverSignature) {
      add(blockers, "BLOCKED_INVALID_APPROVER_SIGNATURE", "Approver signature is missing");
    } else {
      recoveredApprover = recoverRewardAuthorizationSigner(
        authorizationFromJob(authorization),
        authorization.approverSignature,
      );
      if (
        recoveredApprover !== getAddress(input.expectedApprover) ||
        getAddress(authorization.approverAddress) !== getAddress(input.expectedApprover)
      ) {
        add(blockers, "BLOCKED_WRONG_APPROVER", "Recovered or persisted Approver is not the expected Approver");
      }
      if (!await input.reader.hasApproverRole(recoveredApprover)) {
        add(blockers, "BLOCKED_APPROVER_ROLE_MISSING", "Recovered signer does not currently have APPROVER_ROLE");
      }
    }
  } catch {
    add(blockers, "BLOCKED_INVALID_APPROVER_SIGNATURE", "Authorization signature could not be recovered");
  }

  const gasPriceWei = feeData.gasPrice ?? undefined;
  if (gasPriceWei === undefined || gasPriceWei <= 0n) {
    add(blockers, "BLOCKED_GAS_PRICE_UNAVAILABLE", "RPC did not provide a positive legacy gas price");
  } else if (input.maxGasPriceWei !== undefined && gasPriceWei > input.maxGasPriceWei) {
    add(blockers, "BLOCKED_GAS_PRICE_LIMIT", "Observed gas price exceeds MAX_CLAIM_GAS_PRICE_GWEI");
  }

  let estimatedGas: bigint | undefined;
  let gasLimit: bigint | undefined;
  let estimatedFeeWei: bigint | undefined;
  let transaction;
  const canEstimate = blockers.length === 0 && expectedAction === "SIGN_AND_BROADCAST";
  if (canEstimate && authorization.approverSignature && gasPriceWei !== undefined) {
    const baseTransaction = {
      chainId: BSC_TESTNET_CHAIN_ID,
      data: encodeClaimReward(authorizationFromJob(authorization), authorization.approverSignature),
      from: claimant,
      gasPrice: gasPriceWei,
      nonce: currentEthereumTxNonce,
      to: getAddress(input.rewardContractAddress),
      type: 0,
      value: 0n,
    } as const;
    try {
      estimatedGas = await input.provider.estimateGas(baseTransaction);
      gasLimit = applyGasSafetyMargin(estimatedGas);
      estimatedFeeWei = gasLimit * gasPriceWei;
      transaction = { ...baseTransaction, gasLimit };
      if (userGasBalanceWei < estimatedFeeWei) {
        add(blockers, "BLOCKED_INSUFFICIENT_USER_GAS", "User Wallet tBNB balance is below the safety-margined expected fee");
      }
    } catch {
      add(blockers, "BLOCKED_PREFLIGHT_READ_FAILED", "claimReward gas estimation failed or simulated a revert");
    }
  }

  if (blockers.length > 0 && expectedAction === "SIGN_AND_BROADCAST") expectedAction = "BLOCKED";
  return {
    authorization,
    blockers,
    campaign,
    ...(claimantState ? { claimantState } : {}),
    currentEthereumTxNonce,
    ...(estimatedFeeWei === undefined ? {} : { estimatedFeeWei }),
    ...(estimatedGas === undefined ? {} : { estimatedGas }),
    expectedAction,
    ...(gasLimit === undefined ? {} : { gasLimit }),
    ...(gasPriceWei === undefined ? {} : { gasPriceWei }),
    irbBalance,
    latestBlockTimestamp: now,
    ...(recoveredApprover ? { recoveredApprover } : {}),
    rewardContractIrbBalance,
    ...(transaction ? { transaction } : {}),
    transactionsSent: 0,
    userGasBalanceWei,
    ...(input.wallet ? { walletAddress: input.wallet.walletAddress } : {}),
  };
}

function authorizationFromJob(job: AuthorizationJobRecord) {
  return {
    amount: job.amount,
    campaignId: job.campaignId,
    claimant: job.claimant,
    deadline: job.deadline,
    rewardId: job.rewardId,
    rewardNonce: job.rewardNonce,
    validAfter: job.validAfter,
  };
}

function applyGasSafetyMargin(estimate: bigint): bigint {
  const numerator = estimate * BigInt(BASIS_POINTS + CLAIM_GAS_LIMIT_SAFETY_BPS);
  return (numerator + BigInt(BASIS_POINTS - 1)) / BigInt(BASIS_POINTS);
}

function add(
  blockers: ClaimBlocker[],
  code: ClaimBlocker["code"],
  reason: string,
): void {
  if (!blockers.some((blocker) => blocker.code === code)) blockers.push({ code, reason });
}
