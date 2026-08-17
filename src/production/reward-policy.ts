import type { CampaignPolicy } from "./production-types.js";

export interface RewardHistoryReader {
  hasConfirmedFirstReward(chainId: number, policyScope: string, claimant: string): Promise<boolean>;
  hasConfirmedCampaignReward(chainId: number, campaignId: string, claimant: string): Promise<boolean>;
  hasUnresolvedReward(chainId: number, policy: CampaignPolicy, policyScope: string, campaignId: string, claimant: string): Promise<boolean>;
}

export type PolicyDecision =
  | { readonly action: "ELIGIBLE" }
  | { readonly action: "SKIP_ALREADY_REWARDED" }
  | { readonly action: "SKIP_ONCE_PER_CAMPAIGN" }
  | { readonly action: "RECONCILIATION_REQUIRED" };

export async function evaluateCampaignPolicy(input: {
  readonly chainId: number;
  readonly policy: CampaignPolicy;
  readonly policyScope: string;
  readonly campaignId: string;
  readonly claimant: string;
  readonly history: RewardHistoryReader;
}): Promise<PolicyDecision> {
  if (await input.history.hasUnresolvedReward(
    input.chainId, input.policy, input.policyScope, input.campaignId, input.claimant,
  )) return { action: "RECONCILIATION_REQUIRED" };
  if (input.policy === "RECURRING") return { action: "ELIGIBLE" };
  if (input.policy === "FIRST_REWARD_ONLY") {
    return await input.history.hasConfirmedFirstReward(input.chainId, input.policyScope, input.claimant)
      ? { action: "SKIP_ALREADY_REWARDED" }
      : { action: "ELIGIBLE" };
  }
  return await input.history.hasConfirmedCampaignReward(input.chainId, input.campaignId, input.claimant)
    ? { action: "SKIP_ONCE_PER_CAMPAIGN" }
    : { action: "ELIGIBLE" };
}
