import type { ClaimProvider, ClaimTransactionResponse } from "./claim-types.js";

export class ClaimBroadcastUncertainError extends Error {
  public constructor() {
    super("All claim RPC broadcasts were inconclusive; reconcile the signed transaction hash");
    this.name = "ClaimBroadcastUncertainError";
  }
}

export async function broadcastSameSignedClaim(
  rawTransaction: string,
  signedTransactionHash: string,
  providers: readonly Pick<ClaimProvider, "broadcastTransaction">[],
): Promise<ClaimTransactionResponse> {
  for (const provider of providers) {
    try {
      const response = await provider.broadcastTransaction(rawTransaction);
      if (response.hash.toLowerCase() !== signedTransactionHash.toLowerCase()) {
        throw new Error("RPC returned a hash different from the signed claim hash");
      }
      return response;
    } catch {
      // Only identical signed bytes are attempted on the next healthy endpoint.
    }
  }
  throw new ClaimBroadcastUncertainError();
}
