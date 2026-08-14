import { getAddress, type TransactionRequest } from "ethers";

import {
  BASIS_POINTS,
  BSC_TESTNET_CHAIN_ID,
  DEFAULT_TEST_WALLET_COUNT,
  FUNDING_GAS_LIMIT_SAFETY_BPS,
} from "../config/constants.js";
import type { FundingRepository } from "./funding-repository.js";
import type {
  FundingPlan,
  FundingPlanItem,
  FundingProvider,
  FundingWalletTarget,
} from "./funding-types.js";

type PlanProvider = Pick<
  FundingProvider,
  "estimateGas" | "getBalance" | "getFeeData" | "getNetwork"
>;

export interface CreateFundingPlanInput {
  readonly fundingWalletAddress: string;
  readonly maxGasPriceWei: bigint | undefined;
  readonly provider: PlanProvider;
  readonly repository: FundingRepository;
  readonly targetBalanceWei: bigint;
  readonly wallets: readonly FundingWalletTarget[];
}

export function calculateFundingAmount(
  currentBalanceWei: bigint,
  targetBalanceWei: bigint,
): bigint {
  return currentBalanceWei < targetBalanceWei
    ? targetBalanceWei - currentBalanceWei
    : 0n;
}

export function applyGasLimitSafetyMargin(estimatedGas: bigint): bigint {
  return (
    (estimatedGas * BigInt(BASIS_POINTS + FUNDING_GAS_LIMIT_SAFETY_BPS) +
      BigInt(BASIS_POINTS - 1)) /
    BigInt(BASIS_POINTS)
  );
}

export function assertFundingWalletSeparated(
  fundingWalletAddress: string,
  wallets: readonly FundingWalletTarget[],
): void {
  const normalizedFundingAddress = getAddress(fundingWalletAddress);
  if (wallets.some((wallet) => getAddress(wallet.walletAddress) === normalizedFundingAddress)) {
    throw new Error("Funding Wallet address matches an ACTIVE test User Wallet");
  }
}

export async function createFundingPlan(
  input: CreateFundingPlanInput,
): Promise<FundingPlan> {
  if (input.wallets.length !== DEFAULT_TEST_WALLET_COUNT) {
    throw new Error(
      `Funding scope requires exactly ${DEFAULT_TEST_WALLET_COUNT} ACTIVE test User Wallets; found ${input.wallets.length}`,
    );
  }
  assertFundingWalletSeparated(input.fundingWalletAddress, input.wallets);

  const [network, feeData, fundingWalletBalanceWei, activeJobs] = await Promise.all([
    input.provider.getNetwork(),
    input.provider.getFeeData(),
    input.provider.getBalance(input.fundingWalletAddress),
    input.repository.findActiveByWalletAddresses(
      input.wallets.map((wallet) => wallet.walletAddress),
    ),
  ]);
  const chainId = Number(network.chainId);
  if (chainId !== BSC_TESTNET_CHAIN_ID) {
    throw new Error(`Funding is restricted to BSC Testnet chain ID ${BSC_TESTNET_CHAIN_ID}`);
  }
  if (feeData.gasPrice === null || feeData.gasPrice <= 0n) {
    throw new Error("RPC did not return a usable legacy gas price");
  }
  const gasPrice = feeData.gasPrice;
  const activeByWallet = new Map(
    activeJobs.map((job) => [getAddress(job.walletAddress), job]),
  );
  const wallets: FundingPlanItem[] = [];

  for (const wallet of input.wallets) {
    const walletAddress = getAddress(wallet.walletAddress);
    const balanceBeforeWei = await input.provider.getBalance(walletAddress);
    const fundingAmountWei = calculateFundingAmount(
      balanceBeforeWei,
      input.targetBalanceWei,
    );
    const activeJob = activeByWallet.get(walletAddress);
    if (activeJob) {
      wallets.push({
        action: "SKIP_ACTIVE_JOB",
        activeJobId: activeJob.jobId,
        balanceBeforeWei,
        estimatedGasCostWei: 0n,
        fundingAmountWei,
        gasLimit: 0n,
        id: wallet.id,
        targetBalanceWei: input.targetBalanceWei,
        walletAddress,
      });
      continue;
    }
    if (fundingAmountWei === 0n) {
      wallets.push({
        action: "SKIP_SUFFICIENT_BALANCE",
        balanceBeforeWei,
        estimatedGasCostWei: 0n,
        fundingAmountWei: 0n,
        gasLimit: 0n,
        id: wallet.id,
        targetBalanceWei: input.targetBalanceWei,
        walletAddress,
      });
      continue;
    }
    const transaction: TransactionRequest = {
      from: input.fundingWalletAddress,
      to: walletAddress,
      value: fundingAmountWei,
    };
    const gasLimit = applyGasLimitSafetyMargin(
      await input.provider.estimateGas(transaction),
    );
    wallets.push({
      action: "FUND",
      balanceBeforeWei,
      estimatedGasCostWei: gasLimit * gasPrice,
      fundingAmountWei,
      gasLimit,
      id: wallet.id,
      targetBalanceWei: input.targetBalanceWei,
      walletAddress,
    });
  }

  const fundItems = wallets.filter((wallet) => wallet.action === "FUND");
  const totalTopUpRequiredWei = sum(fundItems.map((wallet) => wallet.fundingAmountWei));
  const estimatedGasCostWei = sum(fundItems.map((wallet) => wallet.estimatedGasCostWei));
  const totalRequiredWei = totalTopUpRequiredWei + estimatedGasCostWei;
  return {
    chainId,
    estimatedGasCostWei,
    feeDataGasPriceWei: gasPrice,
    fundingWalletAddress: getAddress(input.fundingWalletAddress),
    fundingWalletBalanceWei,
    gasPriceWithinMaximum:
      input.maxGasPriceWei === undefined || gasPrice <= input.maxGasPriceWei,
    sufficientFundingBalance: fundingWalletBalanceWei >= totalRequiredWei,
    totalRequiredWei,
    totalTopUpRequiredWei,
    transactionsPlanned: fundItems.length,
    transactionsSent: 0,
    wallets,
  };
}

function sum(values: readonly bigint[]): bigint {
  return values.reduce((total, value) => total + value, 0n);
}
