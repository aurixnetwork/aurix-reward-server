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
      "APPROVER_ROLE",
      "REWARD_AUTHORIZATION_TYPEHASH",
      "getCampaign",
      "getLastClaimAt",
      "getNextClaimAt",
      "getRewardNonce",
      "hasRole",
      "isClaimIntervalElapsed",
      "usedRewardIds",
      "eip712Domain",
      "eip712Name",
      "eip712Version",
      "paused",
      "rewardToken",
    ]) {
      expect(functions.has(functionName)).toBe(true);
    }
  });

  it("defines the exact deployed RewardAuthorization tuple order", async () => {
    const bytes = await readFile(
      new URL("../src/contracts/abi/AurixRewardClaim.json", import.meta.url),
      "utf8",
    );
    const abi = JSON.parse(bytes) as Array<{
      inputs?: Array<{ components?: Array<{ name: string; type: string }> }>;
      name?: string;
      type: string;
    }>;
    const claim = abi.find((entry) => entry.type === "function" && entry.name === "claimReward");
    expect(claim?.inputs?.[0]?.components).toEqual([
      { internalType: "address", name: "claimant", type: "address" },
      { internalType: "uint256", name: "amount", type: "uint256" },
      { internalType: "bytes32", name: "campaignId", type: "bytes32" },
      { internalType: "bytes32", name: "rewardId", type: "bytes32" },
      { internalType: "uint256", name: "rewardNonce", type: "uint256" },
      { internalType: "uint256", name: "validAfter", type: "uint256" },
      { internalType: "uint256", name: "deadline", type: "uint256" },
    ]);
  });

  it("defines the exact deployed createCampaign parameter order", async () => {
    const bytes = await readFile(
      new URL("../src/contracts/abi/AurixRewardClaim.json", import.meta.url),
      "utf8",
    );
    const abi = JSON.parse(bytes) as Array<{
      inputs?: Array<{ internalType: string; name: string; type: string }>;
      name?: string;
      type: string;
    }>;
    const createCampaign = abi.find(
      (entry) => entry.type === "function" && entry.name === "createCampaign",
    );
    expect(createCampaign?.inputs).toEqual([
      { internalType: "bytes32", name: "campaignId", type: "bytes32" },
      { internalType: "uint256", name: "budget", type: "uint256" },
      { internalType: "uint256", name: "maxRewardAmount", type: "uint256" },
      { internalType: "uint64", name: "startTime", type: "uint64" },
      { internalType: "uint64", name: "endTime", type: "uint64" },
      { internalType: "uint64", name: "claimInterval", type: "uint64" },
      { internalType: "bool", name: "active", type: "bool" },
    ]);
  });
});
