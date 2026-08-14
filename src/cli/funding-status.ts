import "dotenv/config";

import { createFundingStatusContext } from "./funding-command-context.js";
import { presentFundingStatus } from "./funding-output.js";
import { runCommand } from "./run-command.js";

await runCommand("funding:status:test", async () => {
  const context = await createFundingStatusContext();
  try {
    return presentFundingStatus(await context.repository.listJobs());
  } finally {
    await context.pool.end();
  }
});
