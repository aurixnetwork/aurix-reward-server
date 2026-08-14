import { describe, expect, it } from "vitest";

import {
  parseAuthorizationCommandArgs,
  parseAuthorizationVerifyArgs,
  parseCampaignInspectArgs,
} from "../src/authorization/authorization-cli-args.js";

const campaignId = `0x${"11".repeat(32)}`;

describe("authorization CLI arguments", () => {
  it("parses wallet, campaign, and exact IRB amount", () => {
    expect(parseAuthorizationCommandArgs([
      "--wallet-id", "1", "--campaign-id", campaignId, "--amount", "1.5",
    ])).toEqual({
      amount: 1_500_000_000_000_000_000n,
      campaignId,
      walletId: "1",
    });
  });

  it("accepts authorization argument order without ambiguity", () => {
    expect(parseAuthorizationCommandArgs([
      "--amount", "1", "--campaign-id", campaignId, "--wallet-id", "2",
    ]).walletId).toBe("2");
  });

  it("rejects malformed wallet and campaign identifiers", () => {
    expect(() => parseAuthorizationCommandArgs([
      "--wallet-id", "0", "--campaign-id", campaignId, "--amount", "1",
    ])).toThrow();
    expect(() => parseCampaignInspectArgs(["--campaign-id", "0x1234"])).toThrow();
  });

  it("parses campaign inspection and verification identifiers", () => {
    expect(parseCampaignInspectArgs(["--campaign-id", campaignId])).toBe(campaignId);
    expect(parseAuthorizationVerifyArgs([
      "--job-id", "00000000-0000-4000-8000-000000000001",
    ])).toBe("00000000-0000-4000-8000-000000000001");
  });
});
