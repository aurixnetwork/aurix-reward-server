import "dotenv/config";

import { parseClaimAuthorizationJobId } from "../claim/claim-cli-args.js";
import { ClaimExecutionError } from "../claim/claim-execution-error.js";
import { buildClaimPlan } from "../claim/claim-plan.js";
import { executeClaim } from "../claim/claim-service.js";
import { requireWalletEncryptionConfig } from "../config/environment.js";
import { createClaimCommandContext } from "./claim-command-context.js";
import { runCommand } from "./run-command.js";

await runCommand("claim:execute:test", async () => {
  const authorizationJobId = parseClaimAuthorizationJobId(process.argv.slice(2));
  const context = await createClaimCommandContext();
  try {
    if (!context.config.claimExecution.executionEnabled) {
      throw new ClaimExecutionError("CLAIM_EXECUTION_DISABLED");
    }
    const authorization = await context.authorizationRepository.findByJobId(authorizationJobId);
    if (!authorization) throw new ClaimExecutionError("CLAIM_AUTHORIZATION_NOT_FOUND");
    const [publicWallet, encryptedWallet, existingJob] = await Promise.all([
      context.walletRepository.findPublicById(authorization.walletId),
      context.walletRepository.findEncryptedById(authorization.walletId),
      context.claimRepository.findByAuthorizationJobId(authorization.jobId),
    ]);
    if (!publicWallet || !encryptedWallet) throw new ClaimExecutionError("CLAIM_WALLET_INVALID");
    const plan = await buildClaimPlan({
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
      wallet: publicWallet,
    });
    return executeClaim({
      authorization,
      broadcastProviders: context.providers,
      encryption: requireWalletEncryptionConfig(context.config),
      executionEnabled: context.config.claimExecution.executionEnabled,
      plan,
      reader: context.reader,
      repository: context.claimRepository,
      rewardContractAddress: context.config.contracts.rewardContractAddress,
      token: context.token,
      wallet: encryptedWallet,
    });
  } finally {
    await context.close();
  }
});
