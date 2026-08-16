import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import {
  ActiveAuthorizationExistsError,
  AuthorizationReissueRequiresClaimReconciliationError,
  DuplicateAuthorizationError,
  MySqlAuthorizationRepository,
} from "../src/authorization/authorization-repository.js";

const planned = {
  amount: 1n,
  approverAddress: "0x1563915e194D8CfBA1943570603F7606A3115508",
  campaignId: `0x${"11".repeat(32)}`,
  claimant: "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A",
  deadline: 1_800_000_300n,
  jobId: "00000000-0000-4000-8000-000000000001",
  rewardId: `0x${"22".repeat(32)}`,
  rewardNonce: 7n,
  validAfter: 1_800_000_000n,
  walletId: "1",
};

describe("authorization repository uniqueness", () => {
  it.each(["uq_reward_authorization_jobs_reward_id", "uq_reward_authorization_jobs_active_nonce"])(
    "rejects a database collision on %s",
    async (constraint) => {
      const connection = authorizationConnection();
      connection.execute
        .mockResolvedValueOnce([[], []])
        .mockRejectedValueOnce({ code: "ER_DUP_ENTRY", message: constraint });
      const pool = { getConnection: vi.fn().mockResolvedValue(connection) } as unknown as Pool;
      await expect(
        new MySqlAuthorizationRepository(pool).reservePlanned(
          planned,
          1_800_000_000n,
          vi.fn(),
        ),
      ).rejects.toBeInstanceOf(DuplicateAuthorizationError);
    },
  );

  it("persists PLANNED before signature fields exist", async () => {
    const connection = authorizationConnection();
    connection.execute
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) } as unknown as Pool;
    await new MySqlAuthorizationRepository(pool).reservePlanned(
      planned,
      1_800_000_000n,
      vi.fn(),
    );
    const sql = String(connection.execute.mock.calls[1]?.[0]);
    expect(sql).toContain("'PLANNED'");
    expect(sql).not.toContain("approver_signature");
    expect(sql).not.toContain("typed_data_hash");
  });

  it("rolls back when a still-valid active authorization is locked", async () => {
    const connection = authorizationConnection();
    connection.execute.mockResolvedValueOnce([[authorizationRow({ deadline: "1800000001" })], []]);
    const repository = new MySqlAuthorizationRepository({
      getConnection: vi.fn().mockResolvedValue(connection),
    } as unknown as Pool);
    await expect(repository.reservePlanned(planned, 1_800_000_000n, vi.fn()))
      .rejects.toBeInstanceOf(ActiveAuthorizationExistsError);
    expect(String(connection.execute.mock.calls[0]?.[0])).toContain("FOR UPDATE");
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it("atomically preserves an expired row and inserts a fresh PLANNED row", async () => {
    const connection = authorizationConnection();
    connection.execute
      .mockResolvedValueOnce([[authorizationRow()], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    const validate = vi.fn().mockResolvedValue(undefined);
    const repository = new MySqlAuthorizationRepository({
      getConnection: vi.fn().mockResolvedValue(connection),
    } as unknown as Pool);
    const result = await repository.reservePlanned(planned, 1_800_000_000n, validate);
    expect(result).toEqual({ expiredAuthorizationJobId: planned.jobId });
    expect(validate).toHaveBeenCalledWith(expect.objectContaining({
      approverSignature: `0x${"33".repeat(65)}`,
      rewardId: planned.rewardId,
      typedDataHash: `0x${"44".repeat(32)}`,
    }));
    const expireSql = String(connection.execute.mock.calls[2]?.[0]);
    expect(expireSql).toContain("status = 'EXPIRED'");
    expect(expireSql).toContain("expired_at = CURRENT_TIMESTAMP(6)");
    expect(expireSql).not.toMatch(/typed_data_hash\s*=|approver_signature\s*=|reward_id\s*=/);
    expect(String(connection.execute.mock.calls[3]?.[0])).toContain("'PLANNED'");
    expect(connection.commit).toHaveBeenCalledOnce();
  });

  it.each(["SIGNED", "BROADCAST", "PENDING_REVIEW"])(
    "blocks expiration when an unresolved %s claim exists",
    async (status) => {
      const connection = authorizationConnection();
      connection.execute
        .mockResolvedValueOnce([[authorizationRow()], []])
        .mockResolvedValueOnce([[{ job_id: "claim-job", status }], []]);
      const repository = new MySqlAuthorizationRepository({
        getConnection: vi.fn().mockResolvedValue(connection),
      } as unknown as Pool);
      await expect(repository.reservePlanned(planned, 1_800_000_000n, vi.fn()))
        .rejects.toBeInstanceOf(AuthorizationReissueRequiresClaimReconciliationError);
      expect(String(connection.execute.mock.calls[1]?.[0]))
        .toContain("'SIGNED','BROADCAST','PENDING_REVIEW'");
      expect(connection.rollback).toHaveBeenCalledOnce();
    },
  );

  it("treats the active-only unique index as the final concurrent reservation guard", async () => {
    const connection = authorizationConnection();
    connection.execute
      .mockResolvedValueOnce([[], []])
      .mockRejectedValueOnce({ code: "ER_DUP_ENTRY" });
    const repository = new MySqlAuthorizationRepository({
      getConnection: vi.fn().mockResolvedValue(connection),
    } as unknown as Pool);
    await expect(repository.reservePlanned(planned, 1_800_000_000n, vi.fn()))
      .rejects.toBeInstanceOf(DuplicateAuthorizationError);
    expect(connection.rollback).toHaveBeenCalledOnce();
  });
});

function authorizationConnection() {
  return {
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    execute: vi.fn(),
    release: vi.fn(),
    rollback: vi.fn(),
  };
}

function authorizationRow(overrides: Record<string, unknown> = {}) {
  return {
    amount_wei: planned.amount.toString(),
    approver_address: planned.approverAddress,
    approver_signature: `0x${"33".repeat(65)}`,
    campaign_id: planned.campaignId,
    claimant_address: planned.claimant,
    deadline: "1799999999",
    expired_at: null,
    job_id: planned.jobId,
    reward_id: planned.rewardId,
    reward_nonce: planned.rewardNonce.toString(),
    status: "READY",
    typed_data_hash: `0x${"44".repeat(32)}`,
    valid_after: planned.validAfter.toString(),
    wallet_id: planned.walletId,
    ...overrides,
  };
}
