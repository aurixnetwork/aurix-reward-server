# Database migrations

Versioned SQL migrations live in this directory. Filenames must use the form
`NNNN_lowercase_name.sql`; the migration runner applies them in lexical order and
records their SHA-256 checksums in `schema_migrations`.

Each migration file must contain one SQL statement. This keeps the application
pool's `multipleStatements` option disabled.

Phase 2 adds `0001_create_reward_user_wallets.sql`. Phase 3 adds
`0002_create_reward_wallet_funding_jobs.sql`, including exact decimal-string Wei storage and a
unique unresolved-job guard. Neither schema stores plaintext private keys,
mnemonics, or raw signed transactions. Phase 4A adds
`0003_create_reward_authorization_jobs.sql`, including exact uint256 decimal
strings and unique job, reward ID, and campaign/claimant/contract-nonce guards.
It stores the public Approver signature and typed-data hash, never the Approver
key.

Phase 4B-2 adds `0004_create_campaign_execution_operations.sql`. It stores
public operation payloads, signed/broadcast hashes, receipts, blocks, gas, fees,
and status for the three campaign operations. It stores no key or raw signed
transaction.

Phase 5A adds `0005_create_reward_claim_jobs.sql`. Unique authorization-job and
reward-ID keys prevent duplicate execution. It stores separate reward and
Ethereum transaction nonces, signed/broadcast hashes, receipt/event/balance
evidence, and lifecycle state, but no wallet key or raw signed transaction.
