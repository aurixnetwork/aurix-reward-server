import pino, { type DestinationStream, type Logger } from "pino";

const REDACTED_PATHS = [
  "password",
  "privateKey",
  "mnemonic",
  "rpcUrl",
  "primaryUrl",
  "secondaryUrl",
  "authorization",
  "*.password",
  "*.privateKey",
  "*.mnemonic",
  "*.rpcUrl",
  "*.primaryUrl",
  "*.secondaryUrl",
  "config.database.password",
  "config.rpc.primaryUrl",
  "config.rpc.secondaryUrl",
  "req.headers.authorization",
  "headers.authorization",
] as const;

export function createLogger(
  level: string = process.env.LOG_LEVEL ?? "info",
  destination?: DestinationStream,
): Logger {
  return pino(
    {
      base: null,
      level,
      redact: {
        censor: "[REDACTED]",
        paths: [...REDACTED_PATHS],
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    destination,
  );
}
