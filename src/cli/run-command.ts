import { ConfigurationError } from "../config/environment.js";
import { createLogger } from "../logging/logger.js";
import { PreflightValidationError } from "../blockchain/preflight.js";

export async function runCommand(
  command: string,
  action: () => Promise<unknown>,
): Promise<void> {
  const logger = createLogger();
  try {
    const result = await action();
    logger.info({ command, result }, `${command} passed`);
  } catch (error: unknown) {
    logger.error(
      { command, error: safeErrorDetails(error) },
      `${command} failed`,
    );
    process.exitCode = 1;
  }
}

function safeErrorDetails(error: unknown): Record<string, unknown> {
  if (error instanceof ConfigurationError) {
    return { issues: error.issues, type: error.name };
  }
  if (error instanceof PreflightValidationError) {
    return { failedChecks: error.failedChecks, type: error.name };
  }
  if (error instanceof Error) {
    return { type: error.name };
  }
  return { type: "UnknownError" };
}
