export interface CampaignInventory {
  readonly campaignId: string;
  readonly active: boolean;
  readonly budget: bigint;
  readonly distributed: bigint;
}

export function calculateInventoryReadiness(
  campaigns: readonly CampaignInventory[],
  contractInventory: bigint,
) {
  const campaignRemaining = campaigns.map((campaign) => ({
    campaignId: campaign.campaignId,
    remaining: campaign.budget > campaign.distributed ? campaign.budget - campaign.distributed : 0n,
  }));
  const aggregateActiveLiability = campaignRemaining.reduce(
    (sum, current, index) => sum + (campaigns[index]?.active ? current.remaining : 0n), 0n,
  );
  return {
    campaignRemaining,
    aggregateActiveLiability,
    contractInventory,
    deficit: aggregateActiveLiability > contractInventory ? aggregateActiveLiability - contractInventory : 0n,
    inventoryReady: contractInventory >= aggregateActiveLiability,
    status: contractInventory >= aggregateActiveLiability ? "READY" as const : "INVENTORY_RISK" as const,
  };
}
