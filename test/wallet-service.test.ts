import { Wallet } from "ethers";
import { describe, expect, it } from "vitest";

import { encryptWalletPrivateKey } from "../src/wallets/wallet-crypto.js";
import type { WalletRepository } from "../src/wallets/wallet-repository.js";
import { WalletService } from "../src/wallets/wallet-service.js";
import type {
  EncryptedWalletRecord,
  NewEncryptedWallet,
  PublicWalletRecord,
  WalletStatus,
} from "../src/wallets/wallet-types.js";

const privateKey = `0x${"22".repeat(32)}`;
const walletAddress = new Wallet(privateKey).address;
const encryption = { key: Buffer.alloc(32, 9), version: 1 };

class FakeWalletRepository implements WalletRepository {
  public constructor(
    public encrypted: EncryptedWalletRecord[] = [],
    public publicRecords: PublicWalletRecord[] = [],
  ) {}

  public findEncryptedById(
    id: string,
  ): Promise<EncryptedWalletRecord | undefined> {
    return Promise.resolve(this.encrypted.find((record) => record.id === id));
  }

  public findPublicById(id: string): Promise<PublicWalletRecord | undefined> {
    return Promise.resolve(
      this.publicRecords.find((record) => record.id === id),
    );
  }

  public insert(wallet: NewEncryptedWallet): Promise<EncryptedWalletRecord> {
    if (this.encrypted.some((record) => record.walletAddress === wallet.walletAddress)) {
      return Promise.reject(new Error("duplicate wallet address"));
    }
    const now = new Date("2026-08-14T00:00:00.000Z");
    const saved = {
      ...wallet,
      createdAt: now,
      id: String(this.encrypted.length + 1),
      updatedAt: now,
    };
    this.encrypted.push(saved);
    return Promise.resolve(saved);
  }

  public listActiveEncrypted(): Promise<readonly EncryptedWalletRecord[]> {
    return Promise.resolve(
      this.encrypted.filter((record) => record.status === "ACTIVE"),
    );
  }

  public listPublic(): Promise<readonly PublicWalletRecord[]> {
    return Promise.resolve(this.publicRecords);
  }

  public updateStatus(id: string, status: WalletStatus): Promise<boolean> {
    const record = this.encrypted.find((candidate) => candidate.id === id);
    if (!record) return Promise.resolve(false);
    this.encrypted = this.encrypted.map((candidate) =>
      candidate.id === id ? { ...candidate, status } : candidate,
    );
    return Promise.resolve(true);
  }

  public async withTransaction<T>(
    action: (repository: WalletRepository) => Promise<T>,
  ): Promise<T> {
    return action(this);
  }
}

function validRecord(): EncryptedWalletRecord {
  const now = new Date("2026-08-14T00:00:00.000Z");
  return {
    ...encryptWalletPrivateKey(privateKey, walletAddress, encryption.key, 1),
    createdAt: now,
    id: "1",
    status: "ACTIVE",
    updatedAt: now,
    walletAddress,
  };
}

describe("wallet service", () => {
  it("creates, encrypts, stores, and verifies a wallet", async () => {
    const repository = new FakeWalletRepository();
    const service = new WalletService(repository, encryption, () => ({
      address: walletAddress,
      privateKey,
    }));

    const created = await service.createTestWallets(1);

    expect(created).toEqual([
      { id: "1", status: "ACTIVE", walletAddress, walletNumber: 1 },
    ]);
    expect(repository.encrypted[0]?.encryptedPrivateKey).not.toBe(privateKey);
  });

  it("prevents duplicate generated wallet addresses", async () => {
    const repository = new FakeWalletRepository();
    const service = new WalletService(repository, encryption, () => ({
      address: walletAddress,
      privateKey,
    }));

    await expect(service.createTestWallets(2)).rejects.toThrow(
      "duplicate wallet address",
    );
  });

  it("validates active wallets without exposing key material", async () => {
    const valid = validRecord();
    const invalid = {
      ...valid,
      encryptedPrivateKey: `${valid.encryptedPrivateKey.slice(0, -2)}AA`,
      id: "2",
    };
    const report = await new WalletService(
      new FakeWalletRepository([valid, invalid]),
      encryption,
    ).validateActiveWallets();
    const serialized = JSON.stringify(report);

    expect(report.validated).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.results.map((result) => result.result)).toEqual(["PASS", "FAIL"]);
    expect(serialized).not.toContain(privateKey);
    expect(serialized).not.toContain(valid.encryptedPrivateKey);
    expect(serialized).not.toContain(valid.encryptionAuthTag);
  });

  it("returns repository-projected public listings unchanged", async () => {
    const publicRecord: PublicWalletRecord = {
      createdAt: new Date("2026-08-14T00:00:00.000Z"),
      id: "1",
      status: "ACTIVE",
      walletAddress,
    };
    const listed = await new WalletService(
      new FakeWalletRepository([], [publicRecord]),
      encryption,
    ).listTestWallets();
    expect(listed).toEqual([publicRecord]);
    expect(JSON.stringify(listed)).not.toContain("private");
  });
});
