import { Interface, parseEther, Wallet } from "ethers";
import { describe, expect, it } from "vitest";

import { encodeClaimReward } from "../src/claim/claim-codec.js";
import rewardContractAbi from "../src/contracts/abi/AurixRewardClaim.json" with { type: "json" };

const authorization = {
  amount: parseEther("0.1"),
  campaignId: `0x${"11".repeat(32)}`,
  claimant: new Wallet(`0x${"44".repeat(32)}`).address,
  deadline: 3_000n,
  rewardId: `0x${"22".repeat(32)}`,
  rewardNonce: 7n,
  validAfter: 1_000n,
};
const signature = `0x${"33".repeat(65)}`;

describe("exact claimReward calldata", () => {
  it("encodes the canonical tuple and bytes argument in deployed order", () => {
    const calldata = encodeClaimReward(authorization, signature);
    const parsed = new Interface(rewardContractAbi).parseTransaction({ data: calldata });
    expect(parsed?.name).toBe("claimReward");
    expect([...parsed?.args[0] as readonly unknown[]]).toEqual([
      authorization.claimant,
      authorization.amount,
      authorization.campaignId,
      authorization.rewardId,
      authorization.rewardNonce,
      authorization.validAfter,
      authorization.deadline,
    ]);
    expect(parsed?.args[1]).toBe(signature);
  });

  it("uses the exact deployed selector", () => {
    expect(encodeClaimReward(authorization, signature).slice(0, 10)).toBe("0x0535ad2b");
  });
});
