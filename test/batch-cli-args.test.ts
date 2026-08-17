import { describe, expect, it } from "vitest";

import { parseBatchCommandArgs } from "../src/batch/batch-cli-args.js";

const campaignId = `0x${"11".repeat(32)}`;

describe("batch claim CLI arguments", () => {
  it("accepts an order-independent wallet range and exact IRB amount", () => {
    expect(parseBatchCommandArgs([
      "--amount", "0.1",
      "--wallet-id-end", "10",
      "--campaign-id", campaignId,
      "--wallet-id-start", "1",
    ])).toEqual({
      amount: 100_000_000_000_000_000n,
      campaignId,
      walletIdEnd: 10,
      walletIdStart: 1,
    });
  });

  it("rejects malformed, reversed, duplicate, and unknown arguments", () => {
    expect(() => parseBatchCommandArgs([])).toThrow("Required arguments");
    expect(() => parseBatchCommandArgs([
      "--campaign-id", campaignId,
      "--wallet-id-start", "10",
      "--wallet-id-end", "1",
      "--amount", "0.1",
    ])).toThrow("greater than or equal");
    expect(() => parseBatchCommandArgs([
      "--campaign-id", campaignId,
      "--wallet-id-start", "1",
      "--wallet-id-start", "10",
      "--amount", "0.1",
    ])).toThrow("duplicate");
  });
});
