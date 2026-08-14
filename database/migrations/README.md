# Database migrations

Versioned SQL migrations live in this directory. Filenames must use the form
`NNNN_lowercase_name.sql`; the migration runner applies them in lexical order and
records their SHA-256 checksums in `schema_migrations`.

Each migration file must contain one SQL statement. This keeps the application
pool's `multipleStatements` option disabled.

Phase 2 adds `0001_create_reward_user_wallets.sql`. Phase 3 adds
`0002_create_reward_wallet_funding_jobs.sql`, including exact decimal-string Wei storage and a
unique unresolved-job guard. Neither schema stores plaintext private keys,
mnemonics, or raw signed transactions. Reward and claim tables remain deferred
to their owning phases.
