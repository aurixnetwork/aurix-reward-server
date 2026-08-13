import "dotenv/config";

import { resolve } from "node:path";

import { loadEnvironment } from "../config/environment.js";
import { runMigrations } from "../database/migrations.js";
import { createDatabasePool } from "../database/pool.js";
import { runCommand } from "./run-command.js";

await runCommand("db:migrate", async () => {
  const config = loadEnvironment();
  if (!config.database) {
    throw new Error("Database configuration is not present");
  }

  const pool = createDatabasePool(config.database);
  try {
    return await runMigrations(pool, resolve("database/migrations"));
  } finally {
    await pool.end();
  }
});
