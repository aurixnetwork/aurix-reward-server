import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import {
  DuplicateWalletAddressError,
  MySqlWalletRepository,
} from "../src/wallets/wallet-repository.js";

describe("MySQL wallet repository", () => {
  it("translates the database unique-address constraint", async () => {
    const execute = vi.fn().mockRejectedValue({ code: "ER_DUP_ENTRY" });
    const repository = MySqlWalletRepository.create({ execute } as unknown as Pool);

    await expect(
      repository.insert({
        encryptedPrivateKey: "ciphertext",
        encryptionAuthTag: "tag",
        encryptionIv: "iv",
        encryptionKeyVersion: 1,
        status: "ACTIVE",
        walletAddress: "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A",
      }),
    ).rejects.toBeInstanceOf(DuplicateWalletAddressError);
  });

  it("lists only public wallet fields", async () => {
    const execute = vi.fn().mockResolvedValue([
      [
        {
          created_at: new Date("2026-08-14T00:00:00.000Z"),
          id: 1,
          status: "ACTIVE",
          wallet_address: "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A",
        },
      ],
      [],
    ]);
    const repository = MySqlWalletRepository.create({ execute } as unknown as Pool);

    const wallets = await repository.listPublic();
    const query = String(execute.mock.calls[0]?.[0]);

    expect(wallets).toEqual([
      {
        createdAt: new Date("2026-08-14T00:00:00.000Z"),
        id: "1",
        status: "ACTIVE",
        walletAddress: "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A",
      },
    ]);
    expect(query).not.toContain("encrypted_private_key");
    expect(JSON.stringify(wallets)).not.toContain("encrypted");
  });

  it("commits a successful wallet batch transaction", async () => {
    const connection = {
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      execute: vi.fn(),
      release: vi.fn(),
      rollback: vi.fn().mockResolvedValue(undefined),
    };
    const pool = {
      execute: vi.fn(),
      getConnection: vi.fn().mockResolvedValue(connection),
    } as unknown as Pool;

    const result = await MySqlWalletRepository.create(pool).withTransaction(
      () => Promise.resolve("committed"),
    );

    expect(result).toBe("committed");
    expect(connection.beginTransaction).toHaveBeenCalledOnce();
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledOnce();
  });

  it("rolls back the complete wallet batch on failure", async () => {
    const connection = {
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      execute: vi.fn(),
      release: vi.fn(),
      rollback: vi.fn().mockResolvedValue(undefined),
    };
    const pool = {
      execute: vi.fn(),
      getConnection: vi.fn().mockResolvedValue(connection),
    } as unknown as Pool;
    const repository = MySqlWalletRepository.create(pool);

    await expect(
      repository.withTransaction(() => Promise.reject(new Error("insert failed"))),
    ).rejects.toThrow("insert failed");
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.release).toHaveBeenCalledOnce();
  });
});
