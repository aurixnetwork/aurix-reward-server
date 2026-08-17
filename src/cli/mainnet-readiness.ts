import "dotenv/config";

import { loadMainnetEnvironment } from "../config/mainnet-environment.js";
import { collectMainnetReadiness } from "../production/mainnet-readiness-service.js";
import { runCommand } from "./run-command.js";

await runCommand("mainnet:readiness", async () => collectMainnetReadiness(loadMainnetEnvironment()));
