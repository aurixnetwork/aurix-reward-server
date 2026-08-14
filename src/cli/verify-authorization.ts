import "dotenv/config";

import { parseAuthorizationVerifyArgs } from "../authorization/authorization-cli-args.js";
import { verifyPersistedAuthorization } from "../authorization/authorization-service.js";
import { createAuthorizationCommandContext } from "./authorization-command-context.js";
import { runCommand } from "./run-command.js";

await runCommand("authorization:verify:test", async () => {
  const jobId = parseAuthorizationVerifyArgs(process.argv.slice(2));
  const context = await createAuthorizationCommandContext();
  try {
    const job = await context.repository.findByJobId(jobId);
    if (!job) throw new Error("Authorization job was not found");
    const result = await verifyPersistedAuthorization(
      job,
      context.reader,
      context.expectedApproverAddress,
      Math.floor(Date.now() / 1_000),
    );
    return {
      ...result,
      currentRewardNonce: result.currentRewardNonce.toString(),
    };
  } finally {
    await context.close();
  }
});
