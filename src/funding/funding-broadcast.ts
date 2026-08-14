import type {
  FundingProvider,
  FundingTransactionResponse,
} from "./funding-types.js";

export class BroadcastUncertainError extends Error {
  public constructor() {
    super("All RPC broadcasts failed; signed transaction state requires reconciliation");
    this.name = "BroadcastUncertainError";
  }
}

export async function broadcastSameSignedTransaction(
  rawTransaction: string,
  signedTransactionHash: string,
  providers: readonly Pick<FundingProvider, "broadcastTransaction">[],
): Promise<FundingTransactionResponse> {
  for (const provider of providers) {
    try {
      const response = await provider.broadcastTransaction(rawTransaction);
      if (response.hash.toLowerCase() !== signedTransactionHash.toLowerCase()) {
        throw new Error("RPC returned a transaction hash different from the signed hash");
      }
      return response;
    } catch {
      // Sending the identical bytes to another endpoint does not create a new transaction.
    }
  }
  throw new BroadcastUncertainError();
}
