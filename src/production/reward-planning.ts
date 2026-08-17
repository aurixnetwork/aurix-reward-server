export interface ProductionSafetyLimits {
  readonly maxWalletsPerRun: number;
  readonly maxTransactionsPerRun: number;
  readonly maxRewardPerWallet: bigint;
  readonly maxAggregateRewardPerRun: bigint;
}

export interface RewardPlan {
  readonly walletCount: number;
  readonly rewardAmountPerWallet: bigint;
  readonly campaignBudgetRequired: bigint;
  readonly buffer: bigint;
  readonly rewardContractInventoryRequired: bigint;
  readonly maximumAggregateReward: bigint;
  readonly maximumTransactions: number;
  readonly kind: "CANARY_5" | "CANARY_10" | "PILOT_100" | "PRODUCTION";
  readonly transactionsSent: 0;
}

export class ProductionLimitError extends Error {
  public constructor(public readonly code: string) {
    super(code);
    this.name = "ProductionLimitError";
  }
}

export function createRewardPlan(input: {
  readonly walletCount: number;
  readonly rewardAmountPerWallet: bigint;
  readonly inventoryBuffer?: bigint;
  readonly limits: ProductionSafetyLimits;
}): RewardPlan {
  if (!Number.isSafeInteger(input.walletCount) || input.walletCount <= 0) throw new ProductionLimitError("INVALID_WALLET_COUNT");
  if (input.rewardAmountPerWallet <= 0n) throw new ProductionLimitError("INVALID_REWARD_AMOUNT");
  const buffer = input.inventoryBuffer ?? 0n;
  if (buffer < 0n) throw new ProductionLimitError("INVALID_INVENTORY_BUFFER");
  const aggregate = BigInt(input.walletCount) * input.rewardAmountPerWallet;
  if (input.walletCount > input.limits.maxWalletsPerRun) throw new ProductionLimitError("MAX_WALLETS_PER_RUN_EXCEEDED");
  if (input.walletCount > input.limits.maxTransactionsPerRun) throw new ProductionLimitError("MAX_TRANSACTIONS_PER_RUN_EXCEEDED");
  if (input.rewardAmountPerWallet > input.limits.maxRewardPerWallet) throw new ProductionLimitError("MAX_REWARD_PER_WALLET_EXCEEDED");
  if (aggregate > input.limits.maxAggregateRewardPerRun) throw new ProductionLimitError("MAX_AGGREGATE_REWARD_PER_RUN_EXCEEDED");
  return {
    walletCount: input.walletCount,
    rewardAmountPerWallet: input.rewardAmountPerWallet,
    campaignBudgetRequired: aggregate,
    buffer,
    rewardContractInventoryRequired: aggregate + buffer,
    maximumAggregateReward: input.limits.maxAggregateRewardPerRun,
    maximumTransactions: input.limits.maxTransactionsPerRun,
    kind: input.walletCount === 5 ? "CANARY_5" : input.walletCount === 10 ? "CANARY_10" : input.walletCount === 100 ? "PILOT_100" : "PRODUCTION",
    transactionsSent: 0,
  };
}
