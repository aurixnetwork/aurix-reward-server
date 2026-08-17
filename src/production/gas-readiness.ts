export interface WalletGasCapacity {
  readonly walletId: string;
  readonly address: string;
  readonly balanceWei: bigint;
}

export function calculateGasReadiness(input: {
  readonly gasPriceWei: bigint;
  readonly estimatedClaimGas: bigint;
  readonly wallets: readonly WalletGasCapacity[];
}) {
  if (input.gasPriceWei <= 0n || input.estimatedClaimGas <= 0n) throw new Error("Positive gas inputs are required");
  const feePerWalletWei = input.gasPriceWei * input.estimatedClaimGas;
  const wallets = input.wallets.map((wallet) => ({
    ...wallet,
    deficitWei: wallet.balanceWei < feePerWalletWei ? feePerWalletWei - wallet.balanceWei : 0n,
    ready: wallet.balanceWei >= feePerWalletWei,
  }));
  const estimate = (count: number) => feePerWalletWei * BigInt(count);
  return {
    gasPriceWei: input.gasPriceWei,
    estimatedClaimGas: input.estimatedClaimGas,
    feePerWalletWei,
    wallets,
    canary5EstimateWei: estimate(5),
    canary10EstimateWei: estimate(10),
    pilot100EstimateWei: estimate(100),
    aggregateFundingRequirementWei: wallets.reduce((sum, wallet) => sum + wallet.deficitWei, 0n),
    gasReady: wallets.length > 0 && wallets.every((wallet) => wallet.ready),
    transactionsSent: 0 as const,
  };
}
