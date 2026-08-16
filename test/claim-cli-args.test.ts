import { describe, expect, it } from "vitest";

import { parseClaimAuthorizationJobId } from "../src/claim/claim-cli-args.js";

describe("claim CLI arguments", () => {
  it("accepts a canonical authorization job UUID", () => {
    expect(parseClaimAuthorizationJobId([
      "--authorization-job-id",
      "0d4ebebf-82f2-4d1a-a7df-c09a4db256ae",
    ])).toBe("0d4ebebf-82f2-4d1a-a7df-c09a4db256ae");
  });

  it("rejects missing, malformed, and unknown arguments", () => {
    expect(() => parseClaimAuthorizationJobId([])).toThrow("required");
    expect(() => parseClaimAuthorizationJobId(["--authorization-job-id", "bad"])).toThrow("UUID");
    expect(() => parseClaimAuthorizationJobId(["--wallet-id", "1"])).toThrow("Unknown");
  });
});
