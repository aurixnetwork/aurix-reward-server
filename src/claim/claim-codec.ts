import { getAddress, Interface } from "ethers";

import type { RewardAuthorization } from "../authorization/authorization-types.js";
import rewardContractAbi from "../contracts/abi/AurixRewardClaim.json" with { type: "json" };
import type { RewardClaimedEvent } from "./claim-types.js";

export const rewardClaimInterface = new Interface(rewardContractAbi);

export function encodeClaimReward(
  authorization: RewardAuthorization,
  approverSignature: string,
): string {
  return rewardClaimInterface.encodeFunctionData("claimReward", [
    {
      claimant: authorization.claimant,
      amount: authorization.amount,
      campaignId: authorization.campaignId,
      rewardId: authorization.rewardId,
      rewardNonce: authorization.rewardNonce,
      validAfter: authorization.validAfter,
      deadline: authorization.deadline,
    },
    approverSignature,
  ]);
}

export function parseRewardClaimedLogs(
  logs: readonly {
    readonly address: string;
    readonly data: string;
    readonly index: number;
    readonly topics: readonly string[];
  }[],
  rewardContractAddress: string,
): readonly RewardClaimedEvent[] {
  const expectedAddress = getAddress(rewardContractAddress);
  const events: RewardClaimedEvent[] = [];
  for (const log of logs) {
    if (getAddress(log.address) !== expectedAddress) continue;
    try {
      const parsed = rewardClaimInterface.parseLog({ data: log.data, topics: [...log.topics] });
      if (!parsed || parsed.name !== "RewardClaimed") continue;
      events.push({
        amount: parsed.args.amount as bigint,
        approver: getAddress(parsed.args.approver as string),
        campaignId: parsed.args.campaignId as string,
        claimant: getAddress(parsed.args.claimant as string),
        claimTimestamp: parsed.args.claimTimestamp as bigint,
        consumedRewardNonce: parsed.args.consumedRewardNonce as bigint,
        logIndex: log.index,
        rewardId: parsed.args.rewardId as string,
      });
    } catch {
      // Ignore logs that are not emitted by the canonical RewardClaimed event.
    }
  }
  return events;
}
