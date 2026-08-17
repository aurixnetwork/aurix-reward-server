import "dotenv/config";

import { parseBatchCommandArgs } from "../batch/batch-cli-args.js";
import {
  createBatchInspection,
  createBatchRunnerDependencies,
  createExistingClaimLifecycle,
} from "../batch/existing-claim-lifecycle.js";
import { presentBatchRun } from "../batch/batch-output.js";
import { runBatchExecution } from "../batch/batch-runner.js";
import { BatchRunAbortedError } from "../batch/batch-types.js";
import { TestRewardEligibilityService } from "../authorization/eligibility.js";
import { ClaimExecutionError } from "../claim/claim-execution-error.js";
import {
  loadEnvironment,
  requireApproverConfig,
  requireAuthorizationPolicy,
  requireWalletEncryptionConfig,
} from "../config/environment.js";
import { createClaimCommandContext } from "./claim-command-context.js";
import { runCommand } from "./run-command.js";

await runCommand("claim:batch:execute:test", async () => {
  const args = parseBatchCommandArgs(process.argv.slice(2));
  const config = loadEnvironment();
  if (!config.claimExecution.executionEnabled) {
    throw new ClaimExecutionError("CLAIM_EXECUTION_DISABLED");
  }
  const policy = requireAuthorizationPolicy(config);
  const approver = requireApproverConfig(config);
  const encryption = requireWalletEncryptionConfig(config);
  const context = await createClaimCommandContext(config);
  try {
    const lifecycle = createExistingClaimLifecycle({
      approver,
      args,
      authorizationReader: context.authorizationReader,
      authorizationRepository: context.authorizationRepository,
      broadcastProviders: context.providers,
      claimReader: context.reader,
      claimRepository: context.claimRepository,
      eligibility: new TestRewardEligibilityService(),
      encryption,
      executionEnabled: true,
      expectedApprover: config.authorization.approverExpectedAddress,
      irbTokenAddress: config.contracts.irbTokenAddress,
      ...(config.claimExecution.maxGasPriceWei === undefined
        ? {}
        : { maxGasPriceWei: config.claimExecution.maxGasPriceWei }),
      primaryProvider: context.primaryProvider,
      rewardContractAddress: config.contracts.rewardContractAddress,
      token: context.token,
      validitySeconds: policy.validitySeconds,
    });
    const report = await runBatchExecution(
      args,
      createBatchRunnerDependencies({
        authorizationJobs: context.authorizationRepository,
        claimJobs: context.claimRepository,
        inspection: createBatchInspection({
          provider: context.primaryProvider,
          rewardContractAddress: config.contracts.rewardContractAddress,
          token: context.token,
        }),
        irbTokenAddress: config.contracts.irbTokenAddress,
        lifecycle,
        ...(config.claimExecution.maxGasPriceWei === undefined
          ? {}
          : { maxGasPriceWei: config.claimExecution.maxGasPriceWei }),
        rewardContractAddress: config.contracts.rewardContractAddress,
        wallets: context.walletRepository,
      }),
      true,
    );
    if (report.status !== "COMPLETED") throw new BatchRunAbortedError(report);
    return presentBatchRun(report);
  } finally {
    await context.close();
  }
});
