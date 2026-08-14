import { randomBytes } from "node:crypto";

import { Wallet } from "ethers";
import { describe, expect, it } from "vitest";

import {
  decryptWalletPrivateKey,
  deriveWalletAddress,
  encryptWalletPrivateKey,
  type EncryptedWalletSecret,
  WalletCryptoError,
} from "../src/wallets/wallet-crypto.js";

const privateKey = `0x${"11".repeat(32)}`;
const walletAddress = new Wallet(privateKey).address;
const encryptionKey = Buffer.alloc(32, 7);

function encryptedFixture(): EncryptedWalletSecret {
  return encryptWalletPrivateKey(privateKey, walletAddress, encryptionKey, 1);
}

function modifyBase64(value: string): string {
  const bytes = Buffer.from(value, "base64");
  bytes[0] = (bytes[0] ?? 0) ^ 1;
  return bytes.toString("base64");
}

describe("wallet AES-256-GCM encryption", () => {
  it("encrypts and decrypts a private key", () => {
    const encrypted = encryptedFixture();
    expect(
      decryptWalletPrivateKey(encrypted, walletAddress, encryptionKey),
    ).toBe(privateKey);
  });

  it("rejects a wrong encryption key", () => {
    expect(() =>
      decryptWalletPrivateKey(encryptedFixture(), walletAddress, Buffer.alloc(32, 8)),
    ).toThrow(WalletCryptoError);
  });

  it("rejects modified ciphertext", () => {
    const encrypted = encryptedFixture();
    expect(() =>
      decryptWalletPrivateKey(
        {
          ...encrypted,
          encryptedPrivateKey: modifyBase64(encrypted.encryptedPrivateKey),
        },
        walletAddress,
        encryptionKey,
      ),
    ).toThrow(WalletCryptoError);
  });

  it("rejects a modified authentication tag", () => {
    const encrypted = encryptedFixture();
    expect(() =>
      decryptWalletPrivateKey(
        {
          ...encrypted,
          encryptionAuthTag: modifyBase64(encrypted.encryptionAuthTag),
        },
        walletAddress,
        encryptionKey,
      ),
    ).toThrow(WalletCryptoError);
  });

  it("rejects a modified IV", () => {
    const encrypted = encryptedFixture();
    expect(() =>
      decryptWalletPrivateKey(
        { ...encrypted, encryptionIv: modifyBase64(encrypted.encryptionIv) },
        walletAddress,
        encryptionKey,
      ),
    ).toThrow(WalletCryptoError);
  });

  it("rejects a stored address mismatch", () => {
    const differentAddress = Wallet.createRandom().address;
    expect(() =>
      decryptWalletPrivateKey(encryptedFixture(), differentAddress, encryptionKey),
    ).toThrow(WalletCryptoError);
  });

  it("derives the expected EVM address from a valid private key", () => {
    expect(deriveWalletAddress(privateKey)).toBe(walletAddress);
  });

  it("uses a unique 12-byte IV for every encryption", () => {
    const ivs = Array.from({ length: 32 }, () => encryptedFixture().encryptionIv);
    expect(new Set(ivs).size).toBe(ivs.length);
    expect(Buffer.from(ivs[0] ?? "", "base64")).toHaveLength(12);
  });

  it("rejects an encryption key with the wrong byte length", () => {
    expect(() =>
      encryptWalletPrivateKey(privateKey, walletAddress, randomBytes(31), 1),
    ).toThrow(WalletCryptoError);
  });
});
