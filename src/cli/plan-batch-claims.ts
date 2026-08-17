import "dotenv/config";

import { parseBatchCommandArgs } from "../batch/batch-cli-args.js";
import {
  createBatchInspection,
  createBatchRunnerDependencies,
  createExistingClaimLifecycle,
} from "../batch/existing-claim-lifecycle.js";
import { presentBatchRun } from "../batch/batch-output.js";
import { runBatchPlan } from "../batch/batch-runner.js";
import { TestRewardEligibilityService } from "../authorization/eligibility.js";
import { loadEnvironment, requireAuthorizationPolicy } from "../config/environment.js";
import { createClaimCommandContext } from "./claim-command-context.js";
import { runCommand } from "./run-command.js";

await runCommand("claim:batch:plan:test", async () => {
  const args = parseBatchCommandArgs(process.argv.slice(2));
  const config = loadEnvironment();
  const policy = requireAuthorizationPolicy(config);
  const context = await createClaimCommandContext(config);
  try {
    const lifecycle = createExistingClaimLifecycle({
      args,
      authorizationReader: context.authorizationReader,
      authorizationRepository: context.authorizationRepository,
      broadcastProviders: context.providers,
      claimReader: context.reader,
      claimRepository: context.claimRepository,
      eligibility: new TestRewardEligibilityService(),
      executionEnabled: false,
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
    return presentBatchRun(await runBatchPlan(
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
    ));
  } finally {
    await context.close();
  }
});
