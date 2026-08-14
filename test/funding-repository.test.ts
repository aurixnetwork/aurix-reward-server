import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import {
  ActiveFundingJobError,
  MySqlFundingRepository,
} from "../src/funding/funding-repository.js";

const signedInput = {
  balanceBeforeWei: 1n,
  fundingAmountWei: 2n,
  fundingWalletAddress: "0x1563915e194D8CfBA1943570603F7606A3115508",
  gasLimit: 23_100n,
  id: "1",
  jobId: "a".repeat(64),
  networkChainId: 97,
  signedTxHash: `0x${"ab".repeat(32)}`,
  targetBalanceWei: 3n,
  txNonce: 7,
  walletAddress: "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A",
} as const;

describe("funding repository", () => {
  it("prevents a duplicate active funding job", async () => {
    const pool = {
      execute: vi.fn().mockRejectedValue({ code: "ER_DUP_ENTRY" }),
    } as unknown as Pool;
    await expect(
      new MySqlFundingRepository(pool).insertSigned(signedInput),
    ).rejects.toBeInstanceOf(ActiveFundingJobError);
  });

  it("persists SIGNED state and signed hash before callers can broadcast", async () => {
    const execute = vi.fn().mockResolvedValue([{ affectedRows: 1 }, []]);
    const repository = new MySqlFundingRepository({ execute } as unknown as Pool);
    await repository.insertSigned(signedInput);
    const sql = String(execute.mock.calls[0]?.[0]);
    const values = execute.mock.calls[0]?.[1] as unknown[];
    expect(sql).toContain("'SIGNED'");
    expect(values).toContain(signedInput.signedTxHash);
  });

  it("queries only unresolved statuses so CONFIRMED history permits later top-up", async () => {
    const execute = vi.fn().mockResolvedValue([[], []]);
    const repository = new MySqlFundingRepository({ execute } as unknown as Pool);
    await repository.findActiveByWalletAddresses([signedInput.walletAddress]);
    const sql = String(execute.mock.calls[0]?.[0]);
    expect(sql).toContain("'SIGNED','BROADCAST','PENDING_REVIEW'");
    expect(sql).not.toContain("'CONFIRMED'");
  });
});
