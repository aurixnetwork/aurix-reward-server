# Changelog

## Unreleased

- Added safe expired-authorization retirement and same-contract-rewardNonce
  reissuance with preserved signature history, fresh job/reward IDs, explicit
  chain/reward-ID checks, and unresolved-claim reconciliation blockers.
- Added migration `0006` with an active-only generated uniqueness guard and
  transactional row locking shared by authorization replacement and claim
  `SIGNED` persistence.

- Added fixed-message, code-based diagnostics for guarded claim execution
  pre-broadcast failures. Generic error messages and underlying signing/database
  details remain hidden, while operators can safely distinguish wallet,
  encryption-version, signing, nonce, campaign-state, and signed-evidence
  persistence failures.

- Added the Phase 5A claimant-funded claim engine with exact deployed calldata,
  comprehensive current-state preflight, encrypted User Wallet address
  validation, pending Ethereum nonce handling, and a separate false-default
  execution guard. Phase 5A development sent zero transactions.
- Added signed-hash-before-broadcast claim evidence, same-bytes RPC failover,
  uncertainty/restart reconciliation, exact `RewardClaimed` and post-state
  confirmation, and atomic authorization consumption.
- Added the `reward_claim_jobs` idempotency/evidence migration plus claim plan,
  execution, status, and reconciliation commands and deterministic coverage.

- Made the Operations tBNB top-up dependent on a pending campaign creation, so
  an already-created campaign never triggers generic balance maintenance.

- Hardened Phase 4B-2 signer custody so Admin, Operations, and IRB Token Owner
  keys are required only when their respective live state-changing action is
  planned; target-satisfied steps report `SKIPPED_NOT_REQUIRED`.

- Added Phase 4B-2 owner-gated Test Campaign execution tooling with an
  independent false-by-default guard, fixed signer address assertions, exact
  execution-time timestamps, and three strictly sequenced transactions.
- Added idempotent Operations gas-target and Reward Contract IRB-inventory
  logic, matching-campaign skip/mismatch stop behavior, exact event/final-state
  validation, uncertainty handling, and signed-hash-before-broadcast evidence
  persistence without keys or raw signed transactions.
- Added zero-transaction campaign execution preflight and status commands plus
  deterministic guard, calldata, timing, balance, role, event, receipt,
  uncertainty, and rerun coverage.

- Added the read-only Phase 4B-1 Test Campaign creation preflight with exact
  Solidity/ABI constraints, deterministic campaign ID, role and balance checks,
  transaction ordering, gas estimates, and zero-transaction output.
- Added non-reverting public-mapping campaign existence reads, deployed claim
  interval reads, IRB owner inspection, and deterministic campaign planning
  coverage without adding a signer or campaign registry.
- Added the Phase 4A Reward Authorization engine with the exact deployed
  EIP-712 domain/type, live campaign and claimant nonce reads, Approver signing,
  signer/role verification, and zero-transaction plan/create/verify commands.
- Added explicit TEST ELIGIBILITY and fail-closed production eligibility
  abstractions, bigint IRB handling, Unix-second validity checks, and
  collision-resistant replay IDs.
- Added the `reward_authorization_jobs` migration with unique reward and
  campaign/claimant/contract-nonce guards plus deterministic authorization,
  tampering, campaign, configuration, repository, and redaction coverage.
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
