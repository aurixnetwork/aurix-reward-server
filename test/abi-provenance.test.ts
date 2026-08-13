import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const EXPECTED_ABI_SHA256 =
  "36eb89b5d3194d3ca82ca46430bec53310067d3fb60223315dbc9ae29abe1c21";

describe("canonical AurixRewardClaim ABI", () => {
  it("matches the documented source artifact byte for byte", async () => {
    const bytes = await readFile(
      new URL("../src/contracts/abi/AurixRewardClaim.json", import.meta.url),
    );
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      EXPECTED_ABI_SHA256,
    );
  });

  it("exposes the required read-only integration methods", async () => {
    const bytes = await readFile(
      new URL("../src/contracts/abi/AurixRewardClaim.json", import.meta.url),
      "utf8",
    );
    const abi = JSON.parse(bytes) as { name?: string; type: string }[];
    const functions = new Set(
      abi.filter((entry) => entry.type === "function").map((entry) => entry.name),
    );
    for (const functionName of [
      "eip712Domain",
      "eip712Name",
      "eip712Version",
      "paused",
      "rewardToken",
    ]) {
      expect(functions.has(functionName)).toBe(true);
    }
  });
});
