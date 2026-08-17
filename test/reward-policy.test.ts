/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from "vitest";

import { evaluateCampaignPolicy, type RewardHistoryReader } from "../src/production/reward-policy.js";

function history(input: { first?: boolean; campaign?: boolean; unresolved?: boolean } = {}): RewardHistoryReader {
  return {
    hasConfirmedFirstReward: vi.fn().mockResolvedValue(input.first ?? false),
    hasConfirmedCampaignReward: vi.fn().mockResolvedValue(input.campaign ?? false),
    hasUnresolvedReward: vi.fn().mockResolvedValue(input.unresolved ?? false),
  };
}
const common = { campaignId: `0x${"11".repeat(32)}`, chainId: 56, claimant: "0x0000000000000000000000000000000000000001", policyScope: "AURIX_INITIAL_V1" };

describe("production campaign policies", () => {
  it("makes a wallet with no confirmed Initial Reward eligible", async () => {
    await expect(evaluateCampaignPolicy({ ...common, history: history(), policy: "FIRST_REWARD_ONLY" })).resolves.toEqual({ action: "ELIGIBLE" });
  });

  it("skips a confirmed Initial Reward durably", async () => {
    await expect(evaluateCampaignPolicy({ ...common, history: history({ first: true }), policy: "FIRST_REWARD_ONLY" })).resolves.toEqual({ action: "SKIP_ALREADY_REWARDED" });
  });

  it("does not use an unrelated current AURX balance", async () => {
    const reader = history();
    await evaluateCampaignPolicy({ ...common, history: reader, policy: "FIRST_REWARD_ONLY" });
    expect(reader.hasConfirmedFirstReward).toHaveBeenCalledOnce();
    expect(Object.keys(reader)).not.toContain("balanceOf");
  });

  it("applies ONCE_PER_CAMPAIGN only to that campaign", async () => {
    await expect(evaluateCampaignPolicy({ ...common, history: history({ campaign: true }), policy: "ONCE_PER_CAMPAIGN" })).resolves.toEqual({ action: "SKIP_ONCE_PER_CAMPAIGN" });
    await expect(evaluateCampaignPolicy({ ...common, campaignId: `0x${"22".repeat(32)}`, history: history(), policy: "ONCE_PER_CAMPAIGN" })).resolves.toEqual({ action: "ELIGIBLE" });
  });

  it("allows RECURRING after the unresolved-state safety check", async () => {
    await expect(evaluateCampaignPolicy({ ...common, history: history(), policy: "RECURRING" })).resolves.toEqual({ action: "ELIGIBLE" });
  });

  it("blocks every policy on unresolved execution evidence", async () => {
    for (const policy of ["FIRST_REWARD_ONLY", "ONCE_PER_CAMPAIGN", "RECURRING"] as const) {
      await expect(evaluateCampaignPolicy({ ...common, history: history({ unresolved: true }), policy })).resolves.toEqual({ action: "RECONCILIATION_REQUIRED" });
    }
  });
});
