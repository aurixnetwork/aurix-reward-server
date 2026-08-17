import "dotenv/config";

import { loadMainnetEnvironment } from "../config/mainnet-environment.js";
import { createDatabasePool } from "../database/pool.js";
import { MySqlProductionRepository } from "../production/production-repository.js";
import { RewardRunAdministration } from "../production/run-administration.js";
import { runCommand } from "./run-command.js";

function option(name: string): string {
  const index = process.argv.indexOf(name);
  const result = index < 0 ? undefined : process.argv[index + 1];
  if (!result) throw new Error(`${name} is required`);
  return result;
}

await runCommand("mainnet:run:admin", async () => {
  const action = process.argv[2];
  const config = loadMainnetEnvironment();
  if (!config.database) throw new Error("Mainnet database configuration is required");
  const pool = createDatabasePool(config.database);
  try {
    const runId = option("--run-id");
    const admin = new RewardRunAdministration(pool, config.limits);
    const repository = new MySqlProductionRepository(pool);
    if (action === "create") {
      const start = Number(option("--wallet-id-start"));
      const end = Number(option("--wallet-id-end"));
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start <= 0 || end < start) throw new Error("INVALID_WALLET_RANGE");
      return await admin.createRun({
        campaignOperationId: option("--campaign-operation-id"), runId,
        walletIds: Array.from({ length: end - start + 1 }, (_, index) => String(start + index)),
      });
    }
    if (action === "start") return { changed: await admin.startRun(runId), runId, status: "RUNNING" };
    if (action === "pause") return { changed: await repository.pauseRun(runId), runId, status: "PAUSED" };
    if (action === "resume") return { changed: await repository.resumeRun(runId), runId, status: "RUNNING" };
    if (action === "stop") return { changed: await admin.stopRun(runId), runId, status: "STOPPED" };
    throw new Error("Action must be create, start, pause, resume, or stop");
  } finally {
    await pool.end();
  }
});
