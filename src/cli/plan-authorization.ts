import "dotenv/config";

import { formatUnits, ZeroHash } from "ethers";

import { parseAuthorizationCommandArgs } from "../authorization/authorization-cli-args.js";
import { TestRewardEligibilityService } from "../authorization/eligibility.js";
import { planRewardAuthorization } from "../authorization/authorization-service.js";
import { createAuthorizationJobId, createRewardId } from "../authorization/reward-id.js";
import { createAuthorizationCommandContext } from "./authorization-command-context.js";
import { runCommand } from "./run-command.js";

await runCommand("authorization:plan:test", async () => {
  const args = parseAuthorizationCommandArgs(process.argv.slice(2));
  const context = await createAuthorizationCommandContext({ requirePolicy: true });
  try {
    const wallet = await context.walletRepository.findPublicById(args.walletId);
    if (!wallet) {
      return { code: "BLOCKED_USER_WALLET_NOT_FOUND", status: "BLOCKED", transactionsSent: 0 };
    }
    const previewJobId = createAuthorizationJobId();
    const plan = await planRewardAuthorization({
      amount: args.amount,
      campaignId: args.campaignId,
      eligibility: new TestRewardEligibilityService(),
      nowSeconds: Math.floor(Date.now() / 1_000),
      reader: context.reader,
      rewardId: ZeroHash,
      validitySeconds: context.policy?.validitySeconds ?? 0,
      wallet,
    });
    if (plan.status === "BLOCKED") return plan;
    const previewRewardId = createRewardId({
      campaignId: args.campaignId,
      claimant: wallet.walletAddress,
      jobId: previewJobId,
      rewardNonce: plan.authorization.rewardNonce,
    });
    const authorizationPreview = {
      ...plan.authorization,
      rewardId: previewRewardId,
    };
    return {
      amountBaseUnits: authorizationPreview.amount.toString(),
      amountIrb: formatUnits(authorizationPreview.amount, 18),
      authorizationPreview: {
        ...authorizationPreview,
        amount: authorizationPreview.amount.toString(),
        deadline: authorizationPreview.deadline.toString(),
        rewardNonce: authorizationPreview.rewardNonce.toString(),
        validAfter: authorizationPreview.validAfter.toString(),
      },
      eligibility: plan.eligibility,
      note: "Preview rewardId is not persisted or reserved",
      status: plan.status,
      transactionsSent: 0,
    };
  } finally {
    await context.close();
  }
});
