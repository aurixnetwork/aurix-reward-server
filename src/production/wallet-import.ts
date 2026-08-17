import { getAddress } from "ethers";

import type { WalletEncryptionConfig } from "../config/environment.js";
import { deriveWalletAddress, encryptWalletPrivateKey } from "../wallets/wallet-crypto.js";
import type { NewEncryptedWallet } from "../wallets/wallet-types.js";

export interface MainnetWalletImportRepository {
  existsByAddress(address: string): Promise<boolean>;
  insertManyMainnet(wallets: readonly NewEncryptedWallet[]): Promise<readonly { readonly id: string; readonly walletAddress: string }[]>;
}

export async function importMainnetWallets(
  inputs: readonly { readonly privateKey: string; readonly expectedAddress?: string }[],
  repository: MainnetWalletImportRepository,
  encryption: WalletEncryptionConfig,
) {
  const seen = new Set<string>();
  const encryptedWallets: NewEncryptedWallet[] = [];
  for (const input of inputs) {
    const derived = deriveWalletAddress(input.privateKey);
    if (input.expectedAddress && getAddress(input.expectedAddress) !== derived) throw new Error("DERIVED_ADDRESS_MISMATCH");
    const key = derived.toLowerCase();
    if (seen.has(key) || await repository.existsByAddress(derived)) throw new Error("DUPLICATE_WALLET");
    seen.add(key);
    const encrypted = encryptWalletPrivateKey(input.privateKey, derived, encryption.key, encryption.version);
    encryptedWallets.push({ ...encrypted, status: "ACTIVE", walletAddress: derived });
  }
  const results = await repository.insertManyMainnet(encryptedWallets);
  return { imported: results.length, wallets: results };
}
