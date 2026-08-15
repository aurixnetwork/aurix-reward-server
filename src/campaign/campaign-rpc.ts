import type { TransactionRequest } from "ethers";

import type {
  CampaignExecutionProvider,
  CampaignReceipt,
  CampaignTransactionResponse,
} from "./campaign-execution-types.js";

export class CampaignReadFailoverProvider implements CampaignExecutionProvider {
  public constructor(private readonly providers: readonly CampaignExecutionProvider[]) {
    if (providers.length === 0) throw new Error("At least one healthy campaign RPC is required");
  }

  public broadcastTransaction(raw: string): Promise<CampaignTransactionResponse> {
    return this.first().broadcastTransaction(raw);
  }
  public estimateGas(transaction: TransactionRequest): Promise<bigint> {
    return this.read((provider) => provider.estimateGas(transaction));
  }
  public getBalance(address: string): Promise<bigint> {
    return this.read((provider) => provider.getBalance(address));
  }
  public getBlock(tag: "latest") {
    return this.read((provider) => provider.getBlock(tag));
  }
  public getCode(address: string): Promise<string> {
    return this.read((provider) => provider.getCode(address));
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
  public getTransactionReceipt(hash: string): Promise<CampaignReceipt | null> {
    return this.read((provider) => provider.getTransactionReceipt(hash));
  }

  private first(): CampaignExecutionProvider {
    const provider = this.providers[0];
    if (!provider) throw new Error("No campaign RPC provider is available");
    return provider;
  }

  private async read<Result>(operation: (provider: CampaignExecutionProvider) => Promise<Result>): Promise<Result> {
    let lastError: unknown;
    for (const provider of this.providers) {
      try {
        return await operation(provider);
      } catch (error: unknown) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("All campaign RPC reads failed");
  }
}
