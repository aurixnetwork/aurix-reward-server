# Changelog

## Unreleased

- Added the Phase 3 BSC Testnet tBNB Funding Wallet configuration, read-only
  ten-wallet plan, guarded sequential execution, and safe status commands.
- Added exact target-balance top-ups, observed gas pricing with optional maximum,
  whole-batch balance preflight, signed-hash-before-broadcast persistence, and
  same-transaction RPC failover/reconciliation.
- Added the `reward_wallet_funding_jobs` lifecycle migration and deterministic
  coverage for funding arithmetic, idempotency, nonce, receipt, timeout,
  execution-guard, redaction, and output safety behavior.
- Added Secretlint's recommended rules to local validation and GitHub CI.

- Added the Phase 2 encrypted BSC Testnet User Wallet system using AES-256-GCM
  with address/version-bound authenticated data.
- Added the `reward_user_wallets` migration, atomic wallet creation, public-only
  listing, and ACTIVE-wallet validation commands.
- Added deterministic wallet crypto, generation, repository, service, CLI count,
  migration, and expanded logger-redaction tests.
- Added wallet security, configuration, database, and operating documentation.
- Added the Phase 1 Node.js 22, TypeScript, and ESM project foundation.
- Added validated read-only BSC Testnet RPC failover, contract clients,
  preflight, health, and inspection commands.
- Imported the canonical AurixRewardClaim ABI with pinned provenance.
- Added structured logging with secret redaction.
- Added the mysql2 configuration and migration foundation.
- Added deterministic tests, linting, documentation, and GitHub Actions CI.
