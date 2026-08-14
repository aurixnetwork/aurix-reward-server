import { describe, expect, it } from "vitest";

import {
  createAuthorizationWindow,
  parseIrbAmount,
} from "../src/authorization/authorization-policy.js";
import { createRewardId } from "../src/authorization/reward-id.js";

describe("authorization amount, time, and rewardId policy", () => {
  it("converts IRB decimals to exact bigint base units", () => {
    expect(parseIrbAmount("1.123456789012345678")).toBe(1_123_456_789_012_345_678n);
  });

  it.each(["0", "-1", "1e2", "0.0000000000000000001"])(
    "rejects invalid IRB amount %s",
    (amount) => expect(() => parseIrbAmount(amount)).toThrow(),
  );

  it("creates an exact Unix-second validity window", () => {
    expect(createAuthorizationWindow(1_800_000_000, 300)).toEqual({
      deadline: 1_800_000_300n,
      validAfter: 1_800_000_000n,
    });
  });

  it("rejects invalid validity seconds", () => {
    expect(() => createAuthorizationWindow(1_800_000_000, 0)).toThrow();
  });

  it("derives a deterministic collision-resistant rewardId from full context", () => {
    const context = {
      campaignId: `0x${"11".repeat(32)}`,
      claimant: "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A",
      jobId: "00000000-0000-4000-8000-000000000001",
      rewardNonce: 7n,
    };
    const entropy = `0x${"22".repeat(32)}`;
    const rewardId = createRewardId(context, entropy);
    expect(createRewardId(context, entropy)).toBe(rewardId);
    expect(createRewardId({ ...context, rewardNonce: 8n }, entropy)).not.toBe(rewardId);
    expect(createRewardId(context, `0x${"23".repeat(32)}`)).not.toBe(rewardId);
  });
});
