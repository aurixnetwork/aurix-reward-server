import { describe, expect, it, vi } from "vitest";

import { FundingReadFailoverProvider } from "../src/funding/funding-rpc.js";
import type { FundingProvider } from "../src/funding/funding-types.js";

describe("funding read RPC failover", () => {
  it("uses the secondary after a primary read failure", async () => {
    const primaryBalance = vi.fn().mockRejectedValue(new Error("primary timeout"));
    const secondaryBalance = vi.fn().mockResolvedValue(123n);
    const primary = { getBalance: primaryBalance } as unknown as FundingProvider;
    const secondary = { getBalance: secondaryBalance } as unknown as FundingProvider;
    const provider = new FundingReadFailoverProvider([primary, secondary]);

    await expect(provider.getBalance("0x0000000000000000000000000000000000000001"))
      .resolves.toBe(123n);
    expect(primaryBalance).toHaveBeenCalledOnce();
    expect(secondaryBalance).toHaveBeenCalledOnce();
  });
});
