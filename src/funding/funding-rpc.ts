import type { TransactionRequest } from "ethers";

import type {
  FundingProvider,
  FundingReceipt,
  FundingTransactionResponse,
} from "./funding-types.js";

export class FundingReadFailoverProvider implements FundingProvider {
  public constructor(private readonly providers: readonly FundingProvider[]) {
    if (providers.length === 0) throw new Error("At least one healthy funding RPC is required");
  }

  public broadcastTransaction(rawTransaction: string): Promise<FundingTransactionResponse> {
    const provider = this.providers[0];
    if (!provider) throw new Error("No funding RPC provider is available");
    return provider.broadcastTransaction(rawTransaction);
  }

  public estimateGas(transaction: TransactionRequest): Promise<bigint> {
    return this.read((provider) => provider.estimateGas(transaction));
  }

  public getBalance(address: string): Promise<bigint> {
    return this.read((provider) => provider.getBalance(address));
  }

  public getFeeData(): Promise<{ readonly gasPrice: bigint | null }> {
    return this.read((provider) => provider.getFeeData());
  }

  public getNetwork(): Promise<{ readonly chainId: bigint }> {
    return this.read((provider) => provider.getNetwork());
  }

  public getTransaction(hash: string): Promise<{ readonly hash?: string } | null> {
    return this.read((provider) => provider.getTransaction(hash));
  }

  public getTransactionCount(address: string, blockTag: "pending"): Promise<number> {
    return this.read((provider) => provider.getTransactionCount(address, blockTag));
  }

  public getTransactionReceipt(hash: string): Promise<FundingReceipt | null> {
    return this.read((provider) => provider.getTransactionReceipt(hash));
  }

  private async read<Result>(operation: (provider: FundingProvider) => Promise<Result>): Promise<Result> {
    let lastError: unknown;
    for (const provider of this.providers) {
      try {
        return await operation(provider);
      } catch (error: unknown) {
        lastError = error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("All funding RPC read endpoints failed");
  }
}
