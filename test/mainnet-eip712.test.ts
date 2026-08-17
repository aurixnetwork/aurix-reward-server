import { Wallet } from "ethers";
import { describe, expect, it } from "vitest";

import type { RewardAuthorization } from "../src/authorization/authorization-types.js";
import {
  createRewardAuthorizationDomain,
  hashRewardAuthorization,
  recoverRewardAuthorizationSigner,
  signRewardAuthorization,
} from "../src/authorization/eip712.js";

const contract = "0x0000000000000000000000000000000000000056";
const authorization: RewardAuthorization = {
  amount: 1n, campaignId: `0x${"11".repeat(32)}`,
  claimant: "0x0000000000000000000000000000000000000001",
  deadline: 2n, rewardId: `0x${"22".repeat(32)}`, rewardNonce: 0n, validAfter: 0n,
};

describe("profile-aware EIP-712", () => {
  it("creates the exact Mainnet domain with the future deployed contract", () => {
    expect(createRewardAuthorizationDomain(56, contract)).toEqual({
      chainId: 56, name: "AurixRewardClaim", verifyingContract: contract, version: "1",
    });
  });

  it("isolates Testnet and Mainnet typed-data hashes", () => {
    expect(hashRewardAuthorization(authorization, createRewardAuthorizationDomain(56, contract)))
      .not.toBe(hashRewardAuthorization(authorization));
  });

  it("signs and recovers against the explicitly selected Mainnet domain", async () => {
    const wallet = Wallet.createRandom();
    const domain = createRewardAuthorizationDomain(56, contract);
    const signature = await signRewardAuthorization(authorization, wallet.privateKey, domain);
    expect(recoverRewardAuthorizationSigner(authorization, signature, domain)).toBe(wallet.address);
  });
});
