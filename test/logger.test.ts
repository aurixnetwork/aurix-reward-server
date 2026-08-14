import { Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import { createLogger } from "../src/logging/logger.js";

describe("structured logger", () => {
  it("redacts credential-like fields", () => {
    let output = "";
    const destination = new Writable({
      write(
        chunk: Buffer,
        encoding: BufferEncoding,
        callback: (error?: Error | null) => void,
      ) {
        void encoding;
        output += chunk.toString("utf8");
        callback();
      },
    });
    const logger = createLogger("info", destination);

    logger.info({
      APPROVER_PRIVATE_KEY: "approver-secret",
      TESTNET_FUNDING_PRIVATE_KEY: "funding-secret",
      WALLET_ENCRYPTION_KEY: "encryption-secret",
      config: {
        database: { password: "database-secret" },
        rpc: { primaryUrl: "sensitive-rpc-value" },
        walletEncryption: { key: "nested-encryption-secret" },
      },
      encrypted_private_key: "ciphertext-secret",
      encryption_auth_tag: "authentication-secret",
      mnemonic: "mnemonic-secret",
      privateKey: "wallet-secret",
      private_key: "snake-wallet-secret",
      rawTransaction: "raw-transaction-secret",
      seed: "seed-secret",
      signedTransaction: "signed-transaction-secret",
    });

    expect(output).not.toContain("database-secret");
    expect(output).not.toContain("wallet-secret");
    expect(output).not.toContain("sensitive-rpc-value");
    for (const secret of [
      "approver-secret",
      "funding-secret",
      "encryption-secret",
      "nested-encryption-secret",
      "ciphertext-secret",
      "authentication-secret",
      "mnemonic-secret",
      "snake-wallet-secret",
      "seed-secret",
      "raw-transaction-secret",
      "signed-transaction-secret",
    ]) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain("[REDACTED]");
  });
});
