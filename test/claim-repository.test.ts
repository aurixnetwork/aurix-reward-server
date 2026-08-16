import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import {
  AuthorizationNotReadyForClaimError,
  DuplicateClaimJobError,
  MySqlClaimRepository,
} from "../src/claim/claim-repository.js";

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
  it("prevents duplicate claim jobs by authorization and rewardId", async () => {
    const connection = claimInsertConnection();
    connection.execute
      .mockResolvedValueOnce([[{ status: "READY" }], []])
      .mockRejectedValueOnce({ code: "ER_DUP_ENTRY" });
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) } as unknown as Pool;
    await expect(new MySqlClaimRepository(pool).insertSigned(input))
      .rejects.toBeInstanceOf(DuplicateClaimJobError);
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
      .rejects.toBeInstanceOf(AuthorizationNotReadyForClaimError);
    expect(connection.execute).toHaveBeenCalledOnce();
    expect(connection.rollback).toHaveBeenCalledOnce();
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
