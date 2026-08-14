import type { EncryptedWalletSecret } from "./wallet-crypto.js";

export type WalletStatus = "ACTIVE" | "DISABLED";

export interface NewEncryptedWallet extends EncryptedWalletSecret {
  readonly status: WalletStatus;
  readonly walletAddress: string;
}

export interface EncryptedWalletRecord extends NewEncryptedWallet {
  readonly createdAt: Date;
  readonly id: string;
  readonly updatedAt: Date;
}

export interface PublicWalletRecord {
  readonly createdAt: Date;
  readonly id: string;
  readonly status: WalletStatus;
  readonly walletAddress: string;
}
