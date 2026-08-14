import { Wallet } from "ethers";
import { describe, expect, it } from "vitest";

import type { RewardAuthorization } from "../src/authorization/authorization-types.js";
import {
  hashRewardAuthorization,
  recoverRewardAuthorizationSigner,
  REWARD_AUTHORIZATION_DOMAIN,
  REWARD_AUTHORIZATION_TYPES,
  signRewardAuthorization,
  validateRewardAuthorization,
} from "../src/authorization/eip712.js";
import {
  AURIX_REWARD_CONTRACT_ADDRESS,
  TESTNET_APPROVER_ADDRESS,
} from "../src/config/constants.js";

const privateKey = `0x${"44".repeat(32)}`;
const signerAddress = new Wallet(privateKey).address;
const authorization: RewardAuthorization = {
  amount: 123_456_789_012_345_678n,
  campaignId: `0x${"11".repeat(32)}`,
  claimant: "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A",
  deadline: 1_800_000_100n,
  rewardId: `0x${"22".repeat(32)}`,
  rewardNonce: 7n,
  validAfter: 1_800_000_000n,
};

describe("canonical RewardAuthorization EIP-712", () => {
  it("uses the exact fixed domain", () => {
    expect(REWARD_AUTHORIZATION_DOMAIN).toEqual({
      chainId: 97,
      name: "AurixRewardClaim",
      verifyingContract: AURIX_REWARD_CONTRACT_ADDRESS,
      version: "1",
    });
    expect(TESTNET_APPROVER_ADDRESS).toBe("0x425f7117D36aC8F45224E895e583b404E0a6eb05");
  });

  it("uses the exact Solidity field ordering", () => {
    expect(REWARD_AUTHORIZATION_TYPES.RewardAuthorization).toEqual([
      { name: "claimant", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "campaignId", type: "bytes32" },
      { name: "rewardId", type: "bytes32" },
      { name: "rewardNonce", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ]);
  });

  it("produces a stable typed-data hash", () => {
    expect(hashRewardAuthorization(authorization)).toBe(
      "0xd30223ce8aefb33993fd3717baf3ee4e0e46607db2d76b5d35aa2f31ccd850f9",
    );
  });

  it("signs and recovers the valid Approver", async () => {
    const signature = await signRewardAuthorization(authorization, privateKey);
    expect(recoverRewardAuthorizationSigner(authorization, signature)).toBe(signerAddress);
  });

  it("rejects a malformed signature", () => {
    expect(() => recoverRewardAuthorizationSigner(authorization, "0x1234")).toThrow();
  });

  it.each([
    ["claimant", { claimant: "0x1563915e194D8CfBA1943570603F7606A3115508" }],
    ["amount", { amount: authorization.amount + 1n }],
    ["campaignId", { campaignId: `0x${"33".repeat(32)}` }],
    ["rewardId", { rewardId: `0x${"55".repeat(32)}` }],
    ["rewardNonce", { rewardNonce: authorization.rewardNonce + 1n }],
    ["validAfter", { validAfter: authorization.validAfter + 1n }],
    ["deadline", { deadline: authorization.deadline + 1n }],
  ] as const)("detects altered %s through signer recovery", async (_field, change) => {
    const signature = await signRewardAuthorization(authorization, privateKey);
    const altered = { ...authorization, ...change };
    expect(recoverRewardAuthorizationSigner(altered, signature)).not.toBe(signerAddress);
  });

  it("rejects invalid and expired time windows", () => {
    expect(() => validateRewardAuthorization({
      ...authorization,
      deadline: authorization.validAfter,
    })).toThrow("greater than validAfter");
    expect(() => validateRewardAuthorization(authorization, authorization.deadline)).toThrow("expired");
    expect(() => validateRewardAuthorization(authorization, authorization.validAfter - 1n)).toThrow("future");
  });
});
