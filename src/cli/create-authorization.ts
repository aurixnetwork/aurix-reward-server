import "dotenv/config";

import { parseAuthorizationCommandArgs } from "../authorization/authorization-cli-args.js";
import { createAndSignRewardAuthorization } from "../authorization/authorization-service.js";
import { TestRewardEligibilityService } from "../authorization/eligibility.js";
import { createAuthorizationCommandContext } from "./authorization-command-context.js";
import { runCommand } from "./run-command.js";

await runCommand("authorization:create:test", async () => {
  const args = parseAuthorizationCommandArgs(process.argv.slice(2));
  const context = await createAuthorizationCommandContext({
    requireApprover: true,
    requirePolicy: true,
  });
  try {
    const wallet = await context.walletRepository.findPublicById(args.walletId);
    if (!wallet) throw new Error("User Wallet was not found");
    if (!context.approver || !context.policy) throw new Error("Authorization configuration is incomplete");
    const job = await createAndSignRewardAuthorization({
      amount: args.amount,
      approverAddress: context.approver.address,
      approverPrivateKey: context.approver.privateKey,
      campaignId: args.campaignId,
      clock: () => Math.floor(Date.now() / 1_000),
      eligibility: new TestRewardEligibilityService(),
      nowSeconds: Math.floor(Date.now() / 1_000),
      reader: context.reader,
      repository: context.repository,
      validitySeconds: context.policy.validitySeconds,
      wallet,
    });
    return {
      approverAddress: job.approverAddress,
      jobId: job.jobId,
      rewardId: job.rewardId,
      status: job.status,
      typedDataHash: job.typedDataHash,
      transactionsSent: 0,
    };
  } finally {
    await context.close();
  }
});
