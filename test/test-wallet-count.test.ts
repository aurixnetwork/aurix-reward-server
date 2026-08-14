import { describe, expect, it } from "vitest";

import { parseTestWalletCount } from "../src/wallets/test-wallet-count.js";

describe("test wallet CLI count", () => {
  it("defaults to 10", () => {
    expect(parseTestWalletCount([])).toBe(10);
  });

  it("accepts both supported count syntaxes", () => {
    expect(parseTestWalletCount(["--count", "7"])).toBe(7);
    expect(parseTestWalletCount(["--count=8"])).toBe(8);
  });

  it("rejects malformed, zero, and negative counts", () => {
    expect(() => parseTestWalletCount(["--count", "nope"])).toThrow();
    expect(() => parseTestWalletCount(["--count", "0"])).toThrow();
    expect(() => parseTestWalletCount(["--count", "-1"])).toThrow();
  });

  it("rejects a count above the maximum", () => {
    expect(() => parseTestWalletCount(["--count", "101"])).toThrow(
      "Wallet count must be an integer from 1 to 100",
    );
  });
});
