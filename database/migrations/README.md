# Database migrations

Versioned SQL migrations live in this directory. Filenames must use the form
`NNNN_lowercase_name.sql`; the migration runner applies them in lexical order and
records their SHA-256 checksums in `schema_migrations`.

Each migration file must contain one SQL statement. This keeps the application
pool's `multipleStatements` option disabled.

Phase 1 intentionally creates only the migration ledger. Operational reward,
wallet, funding, and claim tables will be introduced with their owning phases so
their invariants can be reviewed alongside the code that uses them.
