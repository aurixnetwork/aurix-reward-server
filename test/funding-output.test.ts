import { describe, expect, it } from "vitest";

import { presentFundingStatus } from "../src/cli/funding-output.js";

describe("funding status output", () => {
  it("contains safe operational fields and no secret-shaped material", () => {
    const output = presentFundingStatus([{
      balanceBeforeWei: 1n,
      blockNumber: 42,
      broadcastTxHash: `0x${"ab".repeat(32)}`,
      feePaidWei: 21_000n,
      fundingAmountWei: 2n,
      id: "1",
      jobId: "job-id",
      status: "CONFIRMED",
      walletAddress: "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A",
    }]);
    const serialized = JSON.stringify(output);
    expect(output.counts).toMatchObject({ total: 1, confirmed: 1 });
    expect(serialized).toContain("txHash");
    expect(serialized).not.toMatch(/privateKey|rawTransaction|encrypted_private_key|mnemonic/);
  });
});
