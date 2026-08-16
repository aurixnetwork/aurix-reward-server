import { getAddress } from "ethers";

import type { AuthorizationJobRecord } from "../authorization/authorization-types.js";
import { parseRewardClaimedLogs } from "./claim-codec.js";
import type {
  ClaimChainReader,
  ClaimJobRecord,
  ClaimPostState,
  ClaimReceipt,
  ClaimTokenReader,
  RewardClaimedEvent,
} from "./claim-types.js";

export class ClaimConfirmationError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ClaimConfirmationError";
  }
}

export async function validateConfirmedClaim(input: {
  readonly authorization: AuthorizationJobRecord;
  readonly expectedApprover: string;
  readonly job: Pick<
    ClaimJobRecord,
    "campaignDistributedBefore" | "irbBalanceBefore" | "rewardContractBalanceBefore" | "signedTxHash"
  >;
  readonly reader: ClaimChainReader;
  readonly receipt: ClaimReceipt;
  readonly rewardContractAddress: string;
  readonly token: ClaimTokenReader;
}): Promise<{ readonly event: RewardClaimedEvent; readonly postState: ClaimPostState }> {
  if (input.receipt.status !== 1) {
    throw new ClaimConfirmationError("TRANSACTION_REVERTED", "Claim receipt status is not successful");
  }
  if (input.receipt.hash.toLowerCase() !== input.job.signedTxHash.toLowerCase()) {
    throw new ClaimConfirmationError("RECEIPT_HASH_MISMATCH", "Receipt hash does not match the persisted signed transaction hash");
  }
  const events = parseRewardClaimedLogs(input.receipt.logs, input.rewardContractAddress);
  if (events.length !== 1) {
    throw new ClaimConfirmationError(
      "REWARD_CLAIMED_EVENT_COUNT",
      "Successful receipt must contain exactly one RewardClaimed event",
    );
  }
  const event = events[0];
  if (!event) throw new ClaimConfirmationError("REWARD_CLAIMED_EVENT_MISSING", "RewardClaimed event is missing");
  assertEvent(event, input.authorization, input.expectedApprover);

  const [irbBalanceAfter, rewardContractBalanceAfter, campaign, claimantState, rewardIdUsed] =
    await Promise.all([
      input.token.balanceOf(input.authorization.claimant),
      input.token.balanceOf(input.rewardContractAddress),
      input.reader.getCampaign(input.authorization.campaignId),
      input.reader.getClaimantState(
        input.authorization.campaignId,
        input.authorization.claimant,
      ),
      input.reader.isRewardIdUsed(input.authorization.rewardId),
    ]);
  const postState: ClaimPostState = {
    campaignDistributedAfter: campaign.distributed,
    irbBalanceAfter,
    lastClaimAtAfter: claimantState.lastClaimAt,
    rewardContractBalanceAfter,
    rewardIdUsed,
    rewardNonceAfter: claimantState.rewardNonce,
  };
  assertPostState(input.authorization, input.job, event, postState);
  return { event, postState };
}

function assertEvent(
  event: RewardClaimedEvent,
  authorization: AuthorizationJobRecord,
  expectedApprover: string,
): void {
  if (event.campaignId.toLowerCase() !== authorization.campaignId.toLowerCase()) {
    throw new ClaimConfirmationError("EVENT_CAMPAIGN_MISMATCH", "RewardClaimed campaignId mismatch");
  }
  if (event.rewardId.toLowerCase() !== authorization.rewardId.toLowerCase()) {
    throw new ClaimConfirmationError("EVENT_REWARD_ID_MISMATCH", "RewardClaimed rewardId mismatch");
  }
  if (getAddress(event.claimant) !== getAddress(authorization.claimant)) {
    throw new ClaimConfirmationError("EVENT_CLAIMANT_MISMATCH", "RewardClaimed claimant mismatch");
  }
  if (getAddress(event.approver) !== getAddress(expectedApprover)) {
    throw new ClaimConfirmationError("EVENT_APPROVER_MISMATCH", "RewardClaimed Approver mismatch");
  }
  if (event.amount !== authorization.amount) {
    throw new ClaimConfirmationError("EVENT_AMOUNT_MISMATCH", "RewardClaimed amount mismatch");
  }
  if (event.consumedRewardNonce !== authorization.rewardNonce) {
    throw new ClaimConfirmationError("EVENT_REWARD_NONCE_MISMATCH", "RewardClaimed consumed nonce mismatch");
  }
}

function assertPostState(
  authorization: AuthorizationJobRecord,
  job: Pick<
    ClaimJobRecord,
    "campaignDistributedBefore" | "irbBalanceBefore" | "rewardContractBalanceBefore"
  >,
  event: RewardClaimedEvent,
  state: ClaimPostState,
): void {
  if (state.irbBalanceAfter !== job.irbBalanceBefore + authorization.amount) {
    throw new ClaimConfirmationError("USER_IRB_BALANCE_MISMATCH", "User IRB balance did not increase by the exact reward amount");
  }
  if (state.rewardContractBalanceAfter + authorization.amount !== job.rewardContractBalanceBefore) {
    throw new ClaimConfirmationError("CONTRACT_IRB_BALANCE_MISMATCH", "Reward Contract IRB balance did not decrease by the exact reward amount");
  }
  if (state.campaignDistributedAfter !== job.campaignDistributedBefore + authorization.amount) {
    throw new ClaimConfirmationError("CAMPAIGN_DISTRIBUTED_MISMATCH", "Campaign distributed amount did not increase exactly");
  }
  if (state.rewardNonceAfter !== authorization.rewardNonce + 1n) {
    throw new ClaimConfirmationError("REWARD_NONCE_AFTER_MISMATCH", "Contract rewardNonce did not increment by one");
  }
  if (!state.rewardIdUsed) {
    throw new ClaimConfirmationError("REWARD_ID_NOT_USED", "rewardId is not marked used after successful receipt");
  }
  if (state.lastClaimAtAfter !== event.claimTimestamp || state.lastClaimAtAfter === 0n) {
    throw new ClaimConfirmationError("LAST_CLAIM_AT_MISMATCH", "lastClaimAt does not match RewardClaimed timestamp");
  }
}
