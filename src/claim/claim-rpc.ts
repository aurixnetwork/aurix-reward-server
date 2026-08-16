import type { TransactionRequest } from "ethers";

import type {
  ClaimChainReader,
  ClaimProvider,
  ClaimReceipt,
  ClaimTokenReader,
  ClaimTransactionResponse,
} from "./claim-types.js";

export class ClaimReadFailoverProvider implements ClaimProvider {
  public constructor(private readonly providers: readonly ClaimProvider[]) {
    if (providers.length === 0) throw new Error("At least one healthy claim RPC is required");
  }

  public broadcastTransaction(rawTransaction: string): Promise<ClaimTransactionResponse> {
    return this.first().broadcastTransaction(rawTransaction);
  }

  public estimateGas(transaction: TransactionRequest): Promise<bigint> {
    return this.read((provider) => provider.estimateGas(transaction));
  }

  public getBalance(address: string): Promise<bigint> {
    return this.read((provider) => provider.getBalance(address));
  }

  public getBlock(tag: "latest"): Promise<{ readonly timestamp: number } | null> {
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

  public getTransactionReceipt(hash: string): Promise<ClaimReceipt | null> {
    return this.read((provider) => provider.getTransactionReceipt(hash));
  }

  private first(): ClaimProvider {
    const provider = this.providers[0];
    if (!provider) throw new Error("No claim RPC provider is available");
    return provider;
  }

  private async read<Result>(operation: (provider: ClaimProvider) => Promise<Result>): Promise<Result> {
    let lastError: unknown;
    for (const provider of this.providers) {
      try {
        return await operation(provider);
      } catch (error: unknown) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("All claim RPC reads failed");
  }
}

export class ClaimChainReadFailover implements ClaimChainReader {
  public constructor(private readonly readers: readonly ClaimChainReader[]) {
    if (readers.length === 0) throw new Error("At least one claim chain reader is required");
  }

  public getCampaign(campaignId: string) {
    return this.read((reader) => reader.getCampaign(campaignId));
  }

  public getClaimantState(campaignId: string, claimant: string) {
    return this.read((reader) => reader.getClaimantState(campaignId, claimant));
  }

  public getRewardToken(): Promise<string> {
    return this.read((reader) => reader.getRewardToken());
  }

  public hasApproverRole(account: string): Promise<boolean> {
    return this.read((reader) => reader.hasApproverRole(account));
  }

  public isPaused(): Promise<boolean> {
    return this.read((reader) => reader.isPaused());
  }

  public isRewardIdUsed(rewardId: string): Promise<boolean> {
    return this.read((reader) => reader.isRewardIdUsed(rewardId));
  }

  private async read<Result>(operation: (reader: ClaimChainReader) => Promise<Result>): Promise<Result> {
    let lastError: unknown;
    for (const reader of this.readers) {
      try {
        return await operation(reader);
      } catch (error: unknown) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("All claim contract readers failed");
  }
}

export class ClaimTokenReadFailover implements ClaimTokenReader {
  public constructor(private readonly readers: readonly ClaimTokenReader[]) {
    if (readers.length === 0) throw new Error("At least one claim token reader is required");
  }

  public async balanceOf(account: string): Promise<bigint> {
    let lastError: unknown;
    for (const reader of this.readers) {
      try {
        return await reader.balanceOf(account);
      } catch (error: unknown) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("All claim token readers failed");
  }
}
