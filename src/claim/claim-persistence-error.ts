export type ClaimPersistenceStage =
  | "GET_CONNECTION"
  | "BEGIN_TRANSACTION"
  | "LOCK_AUTHORIZATION"
  | "AUTHORIZATION_NOT_READY"
  | "INSERT_SIGNED_JOB"
  | "COMMIT"
  | "ROLLBACK"
  | "RELEASE";

export type ClaimPersistenceErrorCode =
  | "CLAIM_PERSIST_CONNECTION_FAILED"
  | "CLAIM_PERSIST_BEGIN_FAILED"
  | "CLAIM_PERSIST_AUTH_LOCK_FAILED"
  | "CLAIM_PERSIST_AUTH_NOT_READY"
  | "CLAIM_PERSIST_INSERT_FAILED"
  | "CLAIM_PERSIST_COMMIT_FAILED"
  | "CLAIM_PERSIST_ROLLBACK_FAILED"
  | "CLAIM_PERSIST_RELEASE_FAILED";

export interface ClaimPersistenceCleanupFailure {
  readonly code:
    | "CLAIM_PERSIST_ROLLBACK_FAILED"
    | "CLAIM_PERSIST_RELEASE_FAILED";
  readonly stage: "ROLLBACK" | "RELEASE";
  readonly safeDbCode?: string;
  readonly safeDbErrno?: number;
  readonly safeDbSqlState?: string;
}

interface SafeDbMetadata {
  readonly safeDbCode?: string;
  readonly safeDbErrno?: number;
  readonly safeDbSqlState?: string;
}

const STAGE_DETAILS: Readonly<Record<
  ClaimPersistenceStage,
  { readonly code: ClaimPersistenceErrorCode; readonly safeMessage: string }
>> = {
  GET_CONNECTION: {
    code: "CLAIM_PERSIST_CONNECTION_FAILED",
    safeMessage: "Claim persistence database connection failed",
  },
  BEGIN_TRANSACTION: {
    code: "CLAIM_PERSIST_BEGIN_FAILED",
    safeMessage: "Claim persistence transaction could not begin",
  },
  LOCK_AUTHORIZATION: {
    code: "CLAIM_PERSIST_AUTH_LOCK_FAILED",
    safeMessage: "Claim authorization lock could not be acquired",
  },
  AUTHORIZATION_NOT_READY: {
    code: "CLAIM_PERSIST_AUTH_NOT_READY",
    safeMessage: "Claim authorization is not ready for signed persistence",
  },
  INSERT_SIGNED_JOB: {
    code: "CLAIM_PERSIST_INSERT_FAILED",
    safeMessage: "Signed claim job could not be inserted",
  },
  COMMIT: {
    code: "CLAIM_PERSIST_COMMIT_FAILED",
    safeMessage: "Claim persistence transaction could not be committed",
  },
  ROLLBACK: {
    code: "CLAIM_PERSIST_ROLLBACK_FAILED",
    safeMessage: "Claim persistence transaction rollback failed",
  },
  RELEASE: {
    code: "CLAIM_PERSIST_RELEASE_FAILED",
    safeMessage: "Claim persistence database connection release failed",
  },
};

export class ClaimPersistenceError extends Error {
  public readonly type = "ClaimPersistenceError";
  public readonly code: ClaimPersistenceErrorCode;
  public readonly safeMessage: string;
  public readonly safeDbCode: string | undefined;
  public readonly safeDbErrno: number | undefined;
  public readonly safeDbSqlState: string | undefined;
  public readonly cleanupFailures: readonly ClaimPersistenceCleanupFailure[];

  public constructor(
    public readonly stage: ClaimPersistenceStage,
    metadata: SafeDbMetadata = {},
    cleanupFailures: readonly ClaimPersistenceCleanupFailure[] = [],
  ) {
    const details = STAGE_DETAILS[stage];
    const safeMetadata = sanitizeSafeDbMetadata(metadata);
    super(details.safeMessage);
    this.name = "ClaimPersistenceError";
    this.code = details.code;
    this.safeMessage = details.safeMessage;
    this.safeDbCode = safeMetadata.safeDbCode;
    this.safeDbErrno = safeMetadata.safeDbErrno;
    this.safeDbSqlState = safeMetadata.safeDbSqlState;
    this.cleanupFailures = cleanupFailures.map(sanitizeCleanupFailure);
  }
}

export function claimPersistenceError(
  stage: ClaimPersistenceStage,
  error?: unknown,
): ClaimPersistenceError {
  if (error instanceof ClaimPersistenceError) return error;
  return new ClaimPersistenceError(stage, safeDbMetadata(error));
}

export function withCleanupFailure(
  primary: ClaimPersistenceError,
  stage: "ROLLBACK" | "RELEASE",
  error: unknown,
): ClaimPersistenceError {
  const cleanupError = claimPersistenceError(stage, error);
  const cleanupFailure: ClaimPersistenceCleanupFailure = {
    code: stage === "ROLLBACK"
      ? "CLAIM_PERSIST_ROLLBACK_FAILED"
      : "CLAIM_PERSIST_RELEASE_FAILED",
    stage,
    ...(cleanupError.safeDbCode ? { safeDbCode: cleanupError.safeDbCode } : {}),
    ...(cleanupError.safeDbErrno === undefined
      ? {}
      : { safeDbErrno: cleanupError.safeDbErrno }),
    ...(cleanupError.safeDbSqlState
      ? { safeDbSqlState: cleanupError.safeDbSqlState }
      : {}),
  };
  return new ClaimPersistenceError(
    primary.stage,
    {
      ...(primary.safeDbCode ? { safeDbCode: primary.safeDbCode } : {}),
      ...(primary.safeDbErrno === undefined
        ? {}
        : { safeDbErrno: primary.safeDbErrno }),
      ...(primary.safeDbSqlState
        ? { safeDbSqlState: primary.safeDbSqlState }
        : {}),
    },
    [...primary.cleanupFailures, cleanupFailure],
  );
}

function safeDbMetadata(error: unknown): SafeDbMetadata {
  if (typeof error !== "object" || error === null) return {};
  const candidate = error as Record<string, unknown>;
  return {
    ...(isSafeDbCode(candidate.code) ? { safeDbCode: candidate.code } : {}),
    ...(isSafeDbErrno(candidate.errno) ? { safeDbErrno: candidate.errno } : {}),
    ...(isSafeSqlState(candidate.sqlState)
      ? { safeDbSqlState: candidate.sqlState }
      : {}),
  };
}

function sanitizeSafeDbMetadata(metadata: SafeDbMetadata): SafeDbMetadata {
  return {
    ...(isSafeDbCode(metadata.safeDbCode) ? { safeDbCode: metadata.safeDbCode } : {}),
    ...(isSafeDbErrno(metadata.safeDbErrno) ? { safeDbErrno: metadata.safeDbErrno } : {}),
    ...(isSafeSqlState(metadata.safeDbSqlState)
      ? { safeDbSqlState: metadata.safeDbSqlState }
      : {}),
  };
}

function sanitizeCleanupFailure(
  failure: ClaimPersistenceCleanupFailure,
): ClaimPersistenceCleanupFailure {
  const metadata = sanitizeSafeDbMetadata(failure);
  return {
    code: failure.stage === "ROLLBACK"
      ? "CLAIM_PERSIST_ROLLBACK_FAILED"
      : "CLAIM_PERSIST_RELEASE_FAILED",
    stage: failure.stage,
    ...metadata,
  };
}

function isSafeDbCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{0,63}$/u.test(value);
}

function isSafeDbErrno(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isSafeSqlState(value: unknown): value is string {
  return typeof value === "string" && /^[0-9A-Z]{5}$/u.test(value);
}
