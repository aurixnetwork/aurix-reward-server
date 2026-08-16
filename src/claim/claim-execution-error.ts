export type ClaimExecutionErrorCode =
  | "CLAIM_EXECUTION_DISABLED"
  | "CLAIM_AUTHORIZATION_NOT_FOUND"
  | "CLAIM_PLAN_NOT_EXECUTABLE"
  | "CLAIM_TRANSACTION_INCOMPLETE"
  | "CLAIM_WALLET_INVALID"
  | "CLAIM_ENCRYPTION_VERSION_MISMATCH"
  | "CLAIM_NONCE_MISSING"
  | "CLAIM_CAMPAIGN_STATE_MISSING"
  | "CLAIM_SIGNING_FAILED"
  | "CLAIM_SIGNED_PERSIST_FAILED";

const SAFE_MESSAGES: Readonly<Record<ClaimExecutionErrorCode, string>> = {
  CLAIM_EXECUTION_DISABLED: "Claim execution is disabled by the execution guard",
  CLAIM_AUTHORIZATION_NOT_FOUND: "Claim authorization job was not found",
  CLAIM_PLAN_NOT_EXECUTABLE: "Claim plan is not executable and requires review",
  CLAIM_TRANSACTION_INCOMPLETE: "Claim transaction preparation is incomplete",
  CLAIM_WALLET_INVALID: "Claimant User Wallet validation failed",
  CLAIM_ENCRYPTION_VERSION_MISMATCH: "Claimant wallet encryption key version is not configured",
  CLAIM_NONCE_MISSING: "Pending claimant transaction nonce is missing",
  CLAIM_CAMPAIGN_STATE_MISSING: "Campaign preflight state is missing",
  CLAIM_SIGNING_FAILED: "Claimant transaction signing failed",
  CLAIM_SIGNED_PERSIST_FAILED: "Signed claim evidence could not be persisted",
};

export class ClaimExecutionError extends Error {
  public constructor(public readonly code: ClaimExecutionErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = "ClaimExecutionError";
  }
}
