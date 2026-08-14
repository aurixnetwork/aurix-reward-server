import { randomBytes, randomUUID } from "node:crypto";

import { AbiCoder, getAddress, hexlify, id, isHexString, keccak256 } from "ethers";

export interface RewardIdContext {
  readonly campaignId: string;
  readonly claimant: string;
  readonly jobId: string;
  readonly rewardNonce: bigint;
}

export function createAuthorizationJobId(): string {
  return randomUUID();
}

export function createRewardId(
  context: RewardIdContext,
  entropy: string = hexlify(randomBytes(32)),
): string {
  if (!isHexString(context.campaignId, 32)) throw new Error("campaignId must be bytes32");
  if (!isHexString(entropy, 32)) throw new Error("rewardId entropy must be bytes32");
  return keccak256(AbiCoder.defaultAbiCoder().encode(
    ["bytes32", "address", "uint256", "bytes32", "bytes32"],
    [
      context.campaignId,
      getAddress(context.claimant),
      context.rewardNonce,
      id(context.jobId),
      entropy,
    ],
  ));
}
