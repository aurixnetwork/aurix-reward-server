import "dotenv/config";

import { reconcileClaimJobs } from "../claim/claim-service.js";
import { createClaimCommandContext } from "./claim-command-context.js";
import { runCommand } from "./run-command.js";

await runCommand("claim:reconcile:test", async () => {
  const context = await createClaimCommandContext();
  try {
    return {
      ...await reconcileClaimJobs({
        authorizationRepository: context.authorizationRepository,
        providers: context.providers,
        reader: context.reader,
        repository: context.claimRepository,
        rewardContractAddress: context.config.contracts.rewardContractAddress,
        token: context.token,
      }),
      transactionsSent: 0,
    };
  } finally {
    await context.close();
  }
});
