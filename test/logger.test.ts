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
      config: {
        database: { password: "database-secret" },
        rpc: { primaryUrl: "sensitive-rpc-value" },
      },
      privateKey: "wallet-secret",
    });

    expect(output).not.toContain("database-secret");
    expect(output).not.toContain("wallet-secret");
    expect(output).not.toContain("sensitive-rpc-value");
    expect(output).toContain("[REDACTED]");
  });
});
