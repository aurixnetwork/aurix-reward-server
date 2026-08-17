import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import { ClaimPersistenceError } from "../src/claim/claim-persistence-error.js";
import { MySqlClaimRepository } from "../src/claim/claim-repository.js";

const input = {
  amount: 100n,
  authorizationJobId: "0d4ebebf-82f2-4d1a-a7df-c09a4db256ae",
  campaignDistributedBefore: 0n,
  campaignId: `0x${"11".repeat(32)}`,
  claimant: "0x7564105E977516C53bE337314c7E53838967bDaC",
  gasLimit: 120_000n,
  gasPriceWei: 3_000_000_000n,
  irbBalanceBefore: 0n,
  jobId: "a".repeat(64),
  rewardContractBalanceBefore: 3_300n,
  rewardId: `0x${"22".repeat(32)}`,
  rewardNonce: 7n,
  signedTxHash: `0x${"33".repeat(32)}`,
  txNonce: 42,
  walletId: "1",
} as const;

describe("claim repository", () => {
  it("finds unresolved claim evidence by wallet and campaign", async () => {
    const execute = vi.fn().mockResolvedValue([[], []]);
    await new MySqlClaimRepository({ execute } as unknown as Pool)
      .findUnresolvedByWalletCampaign(input.walletId, input.campaignId);
    const sql = String(execute.mock.calls[0]?.[0]);
    expect(sql).toContain("wallet_id = ? AND campaign_id = ?");
    expect(sql).toContain("'SIGNED','BROADCAST','PENDING_REVIEW'");
    expect(execute.mock.calls[0]?.[1]).toEqual([input.walletId, input.campaignId]);
  });

  it("reports getConnection failures without attempting transaction cleanup", async () => {
    const driverError = mysqlError("ETIMEDOUT", -60, "HY000");
    const pool = { getConnection: vi.fn().mockRejectedValue(driverError) } as unknown as Pool;

    await expect(new MySqlClaimRepository(pool).insertSigned(input)).rejects.toMatchObject({
      code: "CLAIM_PERSIST_CONNECTION_FAILED",
      safeDbCode: "ETIMEDOUT",
      stage: "GET_CONNECTION",
      type: "ClaimPersistenceError",
    });
  });

  it("reports beginTransaction failures and still rolls back and releases", async () => {
    const connection = claimInsertConnection();
    connection.beginTransaction.mockRejectedValue(mysqlError("ER_CANT_CREATE_THREAD", 1135, "HY000"));
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) } as unknown as Pool;

    await expect(new MySqlClaimRepository(pool).insertSigned(input)).rejects.toMatchObject({
      code: "CLAIM_PERSIST_BEGIN_FAILED",
      stage: "BEGIN_TRANSACTION",
    });
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.release).toHaveBeenCalledOnce();
  });

  it("reports authorization FOR UPDATE failures at the lock stage", async () => {
    const connection = claimInsertConnection();
    connection.execute.mockRejectedValueOnce(mysqlError("ER_LOCK_WAIT_TIMEOUT", 1205, "HY000"));
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) } as unknown as Pool;

    await expect(new MySqlClaimRepository(pool).insertSigned(input)).rejects.toMatchObject({
      code: "CLAIM_PERSIST_AUTH_LOCK_FAILED",
      safeDbCode: "ER_LOCK_WAIT_TIMEOUT",
      stage: "LOCK_AUTHORIZATION",
    });
    expect(connection.rollback).toHaveBeenCalledOnce();
  });

  it("reports a safe INSERT stage and duplicate database code", async () => {
    const connection = claimInsertConnection();
    connection.execute
      .mockResolvedValueOnce([[{ status: "READY" }], []])
      .mockRejectedValueOnce(mysqlError("ER_DUP_ENTRY", 1062, "23000"));
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) } as unknown as Pool;

    await expect(new MySqlClaimRepository(pool).insertSigned(input))
      .rejects.toMatchObject({
        code: "CLAIM_PERSIST_INSERT_FAILED",
        safeDbCode: "ER_DUP_ENTRY",
        safeDbErrno: 1062,
        safeDbSqlState: "23000",
        stage: "INSERT_SIGNED_JOB",
      });
    expect(connection.rollback).toHaveBeenCalledOnce();
  });

  it("persists SIGNED and its hash without raw transaction bytes", async () => {
    const connection = claimInsertConnection();
    connection.execute
      .mockResolvedValueOnce([[{ status: "READY" }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) } as unknown as Pool;
    await new MySqlClaimRepository(pool).insertSigned(input);
    const sql = String(connection.execute.mock.calls[1]?.[0]);
    expect(sql).toContain("'SIGNED'");
    expect(connection.execute.mock.calls[1]?.[1]).toContain(input.signedTxHash);
    expect(sql).not.toMatch(/raw_transaction|private_key/);
    expect(String(connection.execute.mock.calls[0]?.[0])).toContain("FOR UPDATE");
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it("cannot persist SIGNED after the authorization is no longer READY", async () => {
    const connection = claimInsertConnection();
    connection.execute.mockResolvedValueOnce([[{ status: "EXPIRED" }], []]);
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) } as unknown as Pool;
    await expect(new MySqlClaimRepository(pool).insertSigned(input))
      .rejects.toMatchObject({
        code: "CLAIM_PERSIST_AUTH_NOT_READY",
        stage: "AUTHORIZATION_NOT_READY",
      });
    expect(connection.execute).toHaveBeenCalledOnce();
    expect(connection.rollback).toHaveBeenCalledOnce();
  });

  it("reports COMMIT failures without changing the primary stage during rollback", async () => {
    const connection = claimInsertConnection();
    connection.execute
      .mockResolvedValueOnce([[{ status: "READY" }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    connection.commit.mockRejectedValue(mysqlError("ER_QUERY_INTERRUPTED", 1317, "70100"));
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) } as unknown as Pool;

    await expect(new MySqlClaimRepository(pool).insertSigned(input)).rejects.toMatchObject({
      code: "CLAIM_PERSIST_COMMIT_FAILED",
      safeDbCode: "ER_QUERY_INTERRUPTED",
      stage: "COMMIT",
    });
    expect(connection.rollback).toHaveBeenCalledOnce();
  });

  it("retains the primary failure when rollback and release also fail", async () => {
    const connection = claimInsertConnection();
    connection.execute.mockRejectedValueOnce(mysqlError("ER_LOCK_DEADLOCK", 1213, "40001"));
    connection.rollback.mockRejectedValue(mysqlError("PROTOCOL_CONNECTION_LOST", -1, "HY000"));
    connection.release.mockImplementation(() => {
      throw mysqlError("PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR", -2, "HY000");
    });
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) } as unknown as Pool;

    await expect(new MySqlClaimRepository(pool).insertSigned(input)).rejects.toMatchObject({
      cleanupFailures: [
        {
          code: "CLAIM_PERSIST_ROLLBACK_FAILED",
          safeDbCode: "PROTOCOL_CONNECTION_LOST",
          stage: "ROLLBACK",
        },
        {
          code: "CLAIM_PERSIST_RELEASE_FAILED",
          safeDbCode: "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR",
          stage: "RELEASE",
        },
      ],
      code: "CLAIM_PERSIST_AUTH_LOCK_FAILED",
      safeDbCode: "ER_LOCK_DEADLOCK",
      stage: "LOCK_AUTHORIZATION",
    });
  });

  it("reports RELEASE when persistence committed but connection release fails", async () => {
    const connection = claimInsertConnection();
    connection.execute
      .mockResolvedValueOnce([[{ status: "READY" }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    connection.release.mockImplementation(() => {
      throw mysqlError("PROTOCOL_CONNECTION_LOST", -1, "HY000");
    });
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) } as unknown as Pool;

    await expect(new MySqlClaimRepository(pool).insertSigned(input)).rejects.toMatchObject({
      code: "CLAIM_PERSIST_RELEASE_FAILED",
      stage: "RELEASE",
    });
    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
  });

  it("never exposes SQL, parameters, driver messages, or secrets", async () => {
    const secret = "test-private-key-and-ciphertext";
    const connection = claimInsertConnection();
    connection.execute.mockRejectedValueOnce(Object.assign(
      mysqlError("ER_PARSE_ERROR", 1064, "42000"),
      {
      parameters: [input.authorizationJobId, secret],
      sql: `SELECT ${secret} FOR UPDATE`,
      sqlMessage: `syntax error near ${secret}`,
      },
    ));
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) } as unknown as Pool;

    let caught: unknown;
    try {
      await new MySqlClaimRepository(pool).insertSigned(input);
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ClaimPersistenceError);
    const serialized = JSON.stringify(caught);
    expect(serialized).toContain("ER_PARSE_ERROR");
    expect(serialized).not.toContain("SELECT");
    expect(serialized).not.toContain(input.authorizationJobId);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("sqlMessage");
    expect(serialized).not.toContain("parameters");
  });

  it("selects only unresolved jobs for reconciliation", async () => {
    const execute = vi.fn().mockResolvedValue([[], []]);
    await new MySqlClaimRepository({ execute } as unknown as Pool).listUnresolved();
    const sql = String(execute.mock.calls[0]?.[0]);
    expect(sql).toContain("'SIGNED','BROADCAST','PENDING_REVIEW'");
    expect(sql).not.toContain("'CONFIRMED'");
  });

  it("consumes authorization only inside confirmed-claim persistence", async () => {
    const connection = {
      beginTransaction: vi.fn(),
      commit: vi.fn(),
      execute: vi.fn().mockResolvedValue([{ affectedRows: 1 }, []]),
      release: vi.fn(),
      rollback: vi.fn(),
    };
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) } as unknown as Pool;
    const receipt = {
      blockNumber: 1, gasPrice: 2n, gasUsed: 3n, hash: `0x${"44".repeat(32)}`,
      logs: [], status: 1,
    };
    await new MySqlClaimRepository(pool).markConfirmed(input.jobId, input.authorizationJobId, {
      event: {
        amount: input.amount, approver: input.claimant, campaignId: input.campaignId,
        claimant: input.claimant, claimTimestamp: 9n, consumedRewardNonce: input.rewardNonce,
        logIndex: 0, rewardId: input.rewardId,
      },
      postState: {
        campaignDistributedAfter: input.amount, irbBalanceAfter: input.amount,
        lastClaimAtAfter: 9n, rewardContractBalanceAfter: 3_200n,
        rewardIdUsed: true, rewardNonceAfter: 8n,
      },
      receipt,
    });
    expect(String(connection.execute.mock.calls[1]?.[0])).toContain("status = 'CONSUMED'");
    expect(connection.commit).toHaveBeenCalledOnce();
  });
});

function claimInsertConnection() {
  return {
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    execute: vi.fn(),
    release: vi.fn(),
    rollback: vi.fn(),
  };
}

function mysqlError(code: string, errno: number, sqlState: string) {
  return Object.assign(new Error("unsafe driver message"), { code, errno, sqlState });
}
