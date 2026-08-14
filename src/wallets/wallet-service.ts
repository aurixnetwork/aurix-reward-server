import type { WalletEncryptionConfig } from "../config/environment.js";
import {
  decryptWalletPrivateKey,
  encryptWalletPrivateKey,
} from "./wallet-crypto.js";
import { generateWallet, type GeneratedWallet } from "./wallet-generator.js";
import type { WalletRepository } from "./wallet-repository.js";
import { assertTestWalletCount } from "./test-wallet-count.js";
import type {
  EncryptedWalletRecord,
  PublicWalletRecord,
} from "./wallet-types.js";

export interface WalletCreationResult {
  readonly id: string;
  readonly status: "ACTIVE";
  readonly walletAddress: string;
  readonly walletNumber: number;
}

export interface WalletValidationResult {
  readonly id: string;
  readonly result: "PASS" | "FAIL";
  readonly walletAddress: string;
}

export interface WalletValidationReport {
  readonly failed: number;
  readonly results: readonly WalletValidationResult[];
  readonly validated: number;
}

export class WalletService {
  public constructor(
    private readonly repository: WalletRepository,
    private readonly encryption: WalletEncryptionConfig,
    private readonly generator: () => GeneratedWallet = generateWallet,
  ) {}

  public async createTestWallets(
    count: number,
  ): Promise<readonly WalletCreationResult[]> {
    assertTestWalletCount(count);
    return this.repository.withTransaction(async (repository) => {
      const created: WalletCreationResult[] = [];
      for (let walletNumber = 1; walletNumber <= count; walletNumber += 1) {
        const generated = this.generator();
        const encrypted = encryptWalletPrivateKey(
          generated.privateKey,
          generated.address,
          this.encryption.key,
          this.encryption.version,
        );
        const saved = await repository.insert({
          ...encrypted,
          status: "ACTIVE",
          walletAddress: generated.address,
        });
        verifyWalletRecord(saved, this.encryption);
        created.push({
          id: saved.id,
          status: "ACTIVE",
          walletAddress: saved.walletAddress,
          walletNumber,
        });
      }
      return created;
    });
  }

  public async listTestWallets(): Promise<readonly PublicWalletRecord[]> {
    return this.repository.listPublic();
  }

  public async validateActiveWallets(): Promise<WalletValidationReport> {
    const records = await this.repository.listActiveEncrypted();
    const results = records.map((record): WalletValidationResult => {
      try {
        verifyWalletRecord(record, this.encryption);
        return {
          id: record.id,
          result: "PASS",
          walletAddress: record.walletAddress,
        };
      } catch {
        return {
          id: record.id,
          result: "FAIL",
          walletAddress: record.walletAddress,
        };
      }
    });
    const failed = results.filter((result) => result.result === "FAIL").length;
    return { failed, results, validated: results.length - failed };
  }
}

function verifyWalletRecord(
  record: EncryptedWalletRecord,
  encryption: WalletEncryptionConfig,
): void {
  if (record.encryptionKeyVersion !== encryption.version) {
    throw new Error("No configured key for the wallet encryption version");
  }
  decryptWalletPrivateKey(record, record.walletAddress, encryption.key);
}
