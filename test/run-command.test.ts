import { afterEach, describe, expect, it, vi } from "vitest";

import { ClaimExecutionError } from "../src/claim/claim-execution-error.js";
import { runCommand } from "../src/cli/run-command.js";

const originalExitCode = process.exitCode;

afterEach(() => {
  process.exitCode = originalExitCode;
});

describe("safe command error logging", () => {
  it("logs the allowlisted Claim error type, code, and safe message", async () => {
    const logger = fakeLogger();
    await runCommand(
      "claim:execute:test",
      () => Promise.reject(new ClaimExecutionError("CLAIM_SIGNING_FAILED")),
      logger,
    );
    expect(logger.errorSpy).toHaveBeenCalledWith(
      {
        command: "claim:execute:test",
        error: {
          code: "CLAIM_SIGNING_FAILED",
          message: "Claimant transaction signing failed",
          type: "ClaimExecutionError",
        },
      },
      "claim:execute:test failed",
    );
  });

  it("does not expose a generic Error message", async () => {
    const logger = fakeLogger();
    const secret = `private-key-${"ab".repeat(32)}`;
    await runCommand(
      "claim:execute:test",
      () => Promise.reject(new Error(`driver failed with ${secret}`)),
      logger,
    );
    const output = JSON.stringify(logger.errorSpy.mock.calls);
    expect(output).toContain('"type":"Error"');
    expect(output).not.toContain("driver failed");
    expect(output).not.toContain(secret);
  });

  it("does not accept a caller-provided unsafe message for Claim errors", () => {
    const error = new ClaimExecutionError("CLAIM_SIGNED_PERSIST_FAILED");
    expect(error.message).toBe("Signed claim evidence could not be persisted");
    expect(JSON.stringify(error)).toBe(
      '{"code":"CLAIM_SIGNED_PERSIST_FAILED","name":"ClaimExecutionError"}',
    );
  });
});

function fakeLogger() {
  const errorSpy = vi.fn();
  const infoSpy = vi.fn();
  return {
    error: errorSpy,
    errorSpy,
    info: infoSpy,
    infoSpy,
  } as unknown as Parameters<typeof runCommand>[2] & {
    readonly errorSpy: ReturnType<typeof vi.fn>;
    readonly infoSpy: ReturnType<typeof vi.fn>;
  };
}
