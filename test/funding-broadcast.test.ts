import { describe, expect, it, vi } from "vitest";

import { broadcastSameSignedTransaction } from "../src/funding/funding-broadcast.js";

describe("funding broadcast failover", () => {
  it("rebroadcasts identical signed bytes without generating a second transaction", async () => {
    const rawTransaction = "0xdeadbeef";
    const signedHash = `0x${"ab".repeat(32)}`;
    const primary = { broadcastTransaction: vi.fn().mockRejectedValue(new Error("timeout")) };
    const response = { hash: signedHash, wait: vi.fn() };
    const secondary = { broadcastTransaction: vi.fn().mockResolvedValue(response) };

    await expect(
      broadcastSameSignedTransaction(rawTransaction, signedHash, [primary, secondary]),
    ).resolves.toBe(response);
    expect(primary.broadcastTransaction).toHaveBeenCalledWith(rawTransaction);
    expect(secondary.broadcastTransaction).toHaveBeenCalledWith(rawTransaction);
  });

  it("keeps an all-endpoint timeout unresolved", async () => {
    const endpoint = { broadcastTransaction: vi.fn().mockRejectedValue(new Error("timeout")) };
    await expect(
      broadcastSameSignedTransaction("0x01", `0x${"cd".repeat(32)}`, [endpoint]),
    ).rejects.toThrow("requires reconciliation");
  });
});
