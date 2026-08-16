import type { Logger } from "pino";

import { ConfigurationError } from "../config/environment.js";
import { createLogger } from "../logging/logger.js";
import { PreflightValidationError } from "../blockchain/preflight.js";
import { WalletValidationCommandError } from "../wallets/wallet-errors.js";
import { AuthorizationBlockedError } from "../authorization/authorization-service.js";
import { ClaimExecutionError } from "../claim/claim-execution-error.js";

type CommandLogger = Pick<Logger, "error" | "info">;

export async function runCommand(
  command: string,
  action: () => Promise<unknown>,
  logger: CommandLogger = createLogger(),
): Promise<void> {
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

export function safeErrorDetails(error: unknown): Record<string, unknown> {
  if (error instanceof ConfigurationError) {
    return { issues: error.issues, type: error.name };
  }
  if (error instanceof PreflightValidationError) {
    return { failedChecks: error.failedChecks, type: error.name };
  }
  if (error instanceof WalletValidationCommandError) {
    return { report: error.report, type: error.name };
  }
  if (error instanceof AuthorizationBlockedError) {
    return { code: error.code, type: error.name };
  }
  if (error instanceof ClaimExecutionError) {
    return { code: error.code, message: error.message, type: error.name };
  }
  if (error instanceof Error) {
    return { type: error.name };
  }
  return { type: "UnknownError" };
}
