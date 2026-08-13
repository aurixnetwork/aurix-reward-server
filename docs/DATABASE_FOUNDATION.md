# Database foundation

Phase 1 includes a lazy `mysql2/promise` pool configuration for MariaDB/MySQL and
a versioned SQL migration runner. Neither RPC health nor contract preflight opens
a database connection.

Migration files belong in `database/migrations`, must follow
`NNNN_lowercase_name.sql`, and must contain one SQL statement. The runner:

1. creates `schema_migrations` if absent;
2. discovers files in lexical order;
3. computes SHA-256 for every migration;
4. refuses a changed migration that was already recorded;
5. applies each pending file and records its checksum.

Run `npm run db:migrate` only after explicitly configuring the database. Phase 1
creates the migration ledger but intentionally defines no operational reward,
wallet, funding, or claim tables. Those schemas belong to the phases that own
their invariants, idempotency rules, and persistence behavior.

Database passwords remain environment-only and are redacted from logs.
