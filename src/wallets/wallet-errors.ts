import type { WalletValidationReport } from "./wallet-service.js";

export class WalletValidationCommandError extends Error {
  public constructor(public readonly report: WalletValidationReport) {
    super("One or more ACTIVE test wallets failed validation");
    this.name = "WalletValidationCommandError";
  }
}
