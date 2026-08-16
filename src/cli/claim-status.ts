import "dotenv/config";

import { parseClaimAuthorizationJobId } from "../claim/claim-cli-args.js";
import { createClaimStatusContext } from "./claim-command-context.js";
import { presentClaimJob } from "./claim-output.js";
import { runCommand } from "./run-command.js";

await runCommand("claim:status:test", async () => {
  const authorizationJobId = parseClaimAuthorizationJobId(process.argv.slice(2));
  const context = await createClaimStatusContext();
  try {
    const job = await context.repository.findByAuthorizationJobId(authorizationJobId);
    return job
      ? { claimJob: presentClaimJob(job), transactionsSent: 0 }
      : { authorizationJobId, claimJob: null, status: "NOT_PLANNED", transactionsSent: 0 };
  } finally {
    await context.pool.end();
  }
});
