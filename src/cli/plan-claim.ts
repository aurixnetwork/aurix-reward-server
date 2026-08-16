import "dotenv/config";

import { parseClaimAuthorizationJobId } from "../claim/claim-cli-args.js";
import { buildClaimPlan } from "../claim/claim-plan.js";
import { createClaimCommandContext } from "./claim-command-context.js";
import { presentClaimPlan } from "./claim-output.js";
import { runCommand } from "./run-command.js";

await runCommand("claim:plan:test", async () => {
  const authorizationJobId = parseClaimAuthorizationJobId(process.argv.slice(2));
  const context = await createClaimCommandContext();
  try {
    const authorization = await context.authorizationRepository.findByJobId(authorizationJobId);
    if (!authorization) throw new Error("Authorization job was not found");
    const [wallet, existingJob] = await Promise.all([
      context.walletRepository.findPublicById(authorization.walletId),
      context.claimRepository.findByAuthorizationJobId(authorization.jobId),
    ]);
    return presentClaimPlan(await buildClaimPlan({
      authorization,
      ...(existingJob ? { existingJob } : {}),
      expectedApprover: context.config.authorization.approverExpectedAddress,
      irbTokenAddress: context.config.contracts.irbTokenAddress,
      ...(context.config.claimExecution.maxGasPriceWei === undefined
        ? {}
        : { maxGasPriceWei: context.config.claimExecution.maxGasPriceWei }),
      provider: context.primaryProvider,
      reader: context.reader,
      rewardContractAddress: context.config.contracts.rewardContractAddress,
      token: context.token,
      ...(wallet ? { wallet } : {}),
    }));
  } finally {
    await context.close();
  }
});
