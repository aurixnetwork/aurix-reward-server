import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import {
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
  it.each(["uq_reward_authorization_jobs_reward_id", "uq_reward_authorization_jobs_nonce"])(
    "rejects a database collision on %s",
    async (constraint) => {
      const pool = {
        execute: vi.fn().mockRejectedValue({ code: "ER_DUP_ENTRY", message: constraint }),
      } as unknown as Pool;
      await expect(
        new MySqlAuthorizationRepository(pool).insertPlanned(planned),
      ).rejects.toBeInstanceOf(DuplicateAuthorizationError);
    },
  );

  it("persists PLANNED before signature fields exist", async () => {
    const execute = vi.fn().mockResolvedValue([{ affectedRows: 1 }, []]);
    await new MySqlAuthorizationRepository({ execute } as unknown as Pool)
      .insertPlanned(planned);
    const sql = String(execute.mock.calls[0]?.[0]);
    expect(sql).toContain("'PLANNED'");
    expect(sql).not.toContain("approver_signature");
    expect(sql).not.toContain("typed_data_hash");
  });
});
