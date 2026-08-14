import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { getAddress, Wallet } from "ethers";

const AES_ALGORITHM = "aes-256-gcm";
const GCM_IV_LENGTH_BYTES = 12;
const GCM_AUTH_TAG_LENGTH_BYTES = 16;

export interface EncryptedWalletSecret {
  readonly encryptedPrivateKey: string;
  readonly encryptionAuthTag: string;
  readonly encryptionIv: string;
  readonly encryptionKeyVersion: number;
}

export class WalletCryptoError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "WalletCryptoError";
  }
}

function additionalAuthenticatedData(address: string, version: number): Buffer {
  return Buffer.from(`${getAddress(address).toLowerCase()}:${version}`, "utf8");
}

function validateEncryptionKey(key: Uint8Array): void {
  if (key.byteLength !== 32) {
    throw new WalletCryptoError("Wallet encryption key must contain exactly 32 bytes");
  }
}

function decodeBase64Field(value: string, field: string): Buffer {
  try {
    const decoded = Buffer.from(value, "base64");
    if (decoded.toString("base64") !== value) {
      throw new Error("non-canonical Base64");
    }
    return decoded;
  } catch {
    throw new WalletCryptoError(`Invalid encrypted wallet ${field}`);
  }
}

export function deriveWalletAddress(privateKey: string): string {
  try {
    return new Wallet(privateKey).address;
  } catch {
    throw new WalletCryptoError("Invalid wallet private key material");
  }
}

export function encryptWalletPrivateKey(
  privateKey: string,
  expectedAddress: string,
  key: Uint8Array,
  encryptionKeyVersion: number,
): EncryptedWalletSecret {
  validateEncryptionKey(key);
  if (!Number.isSafeInteger(encryptionKeyVersion) || encryptionKeyVersion < 1) {
    throw new WalletCryptoError("Invalid wallet encryption key version");
  }

  const normalizedAddress = getAddress(expectedAddress);
  if (deriveWalletAddress(privateKey) !== normalizedAddress) {
    throw new WalletCryptoError("Private key does not match the expected wallet address");
  }

  const encryptionIv = randomBytes(GCM_IV_LENGTH_BYTES);
  const cipher = createCipheriv(AES_ALGORITHM, key, encryptionIv, {
    authTagLength: GCM_AUTH_TAG_LENGTH_BYTES,
  });
  cipher.setAAD(additionalAuthenticatedData(normalizedAddress, encryptionKeyVersion));
  const encryptedPrivateKey = Buffer.concat([
    cipher.update(privateKey, "utf8"),
    cipher.final(),
  ]);

  return {
    encryptedPrivateKey: encryptedPrivateKey.toString("base64"),
    encryptionAuthTag: cipher.getAuthTag().toString("base64"),
    encryptionIv: encryptionIv.toString("base64"),
    encryptionKeyVersion,
  };
}

export function decryptWalletPrivateKey(
  encrypted: EncryptedWalletSecret,
  expectedAddress: string,
  key: Uint8Array,
): string {
  validateEncryptionKey(key);

  try {
    const normalizedAddress = getAddress(expectedAddress);
    const encryptionIv = decodeBase64Field(encrypted.encryptionIv, "IV");
    const authTag = decodeBase64Field(
      encrypted.encryptionAuthTag,
      "authentication tag",
    );
    const ciphertext = decodeBase64Field(
      encrypted.encryptedPrivateKey,
      "ciphertext",
    );
    if (
      encryptionIv.length !== GCM_IV_LENGTH_BYTES ||
      authTag.length !== GCM_AUTH_TAG_LENGTH_BYTES
    ) {
      throw new Error("invalid AES-GCM field length");
    }

    const decipher = createDecipheriv(AES_ALGORITHM, key, encryptionIv, {
      authTagLength: GCM_AUTH_TAG_LENGTH_BYTES,
    });
    decipher.setAAD(
      additionalAuthenticatedData(
        normalizedAddress,
        encrypted.encryptionKeyVersion,
      ),
    );
    decipher.setAuthTag(authTag);
    const privateKey = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
    const derivedAddress = deriveWalletAddress(privateKey);
    const expectedBytes = Buffer.from(normalizedAddress.toLowerCase(), "utf8");
    const derivedBytes = Buffer.from(derivedAddress.toLowerCase(), "utf8");
    if (
      expectedBytes.length !== derivedBytes.length ||
      !timingSafeEqual(expectedBytes, derivedBytes)
    ) {
      throw new Error("wallet address mismatch");
    }
    return privateKey;
  } catch (error: unknown) {
    if (error instanceof WalletCryptoError) {
      throw error;
    }
    throw new WalletCryptoError(
      "Wallet decryption or address verification failed",
    );
  }
}
