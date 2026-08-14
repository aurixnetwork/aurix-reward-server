# Database migrations

Versioned SQL migrations live in this directory. Filenames must use the form
`NNNN_lowercase_name.sql`; the migration runner applies them in lexical order and
records their SHA-256 checksums in `schema_migrations`.

Each migration file must contain one SQL statement. This keeps the application
pool's `multipleStatements` option disabled.

Phase 2 adds `0001_create_reward_user_wallets.sql`. It creates the encrypted test
User Wallet store without plaintext private-key or mnemonic columns. Future
operational reward, funding, and claim tables remain deferred to their owning
phases.
