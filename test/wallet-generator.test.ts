import { isAddress } from "ethers";
import { describe, expect, it } from "vitest";

import { generateWallet } from "../src/wallets/wallet-generator.js";

describe("test wallet generation", () => {
  it("returns a valid EVM address", () => {
    expect(isAddress(generateWallet().address)).toBe(true);
  });

  it("generates unique wallets", () => {
    const addresses = Array.from({ length: 20 }, () => generateWallet().address);
    expect(new Set(addresses).size).toBe(addresses.length);
  });

  it("does not expose a mnemonic field", () => {
    expect(generateWallet()).not.toHaveProperty("mnemonic");
  });
});
