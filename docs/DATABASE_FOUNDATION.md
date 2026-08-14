# Database foundation

The project includes a lazy `mysql2/promise` pool configuration for MariaDB/MySQL and
a versioned SQL migration runner. Neither RPC health nor contract preflight opens
a database connection.

Migration files belong in `database/migrations`, must follow
`NNNN_lowercase_name.sql`, and must contain one SQL statement. The runner:

1. creates `schema_migrations` if absent;
2. discovers files in lexical order;
3. computes SHA-256 for every migration;
4. refuses a changed migration that was already recorded;
5. applies each pending file and records its checksum.

Run `npm run db:migrate` only after explicitly configuring the database.

## Phase 2 wallet schema

Migration `0001_create_reward_user_wallets.sql` adds
`reward_user_wallets` with:

| Column | Purpose |
| --- | --- |
| `id` | Unsigned auto-increment internal ID |
| `wallet_address` | Canonical public address; unique and case-sensitive |
| `encrypted_private_key` | Base64 AES-GCM ciphertext |
| `encryption_iv` | Base64 12-byte per-encryption IV |
| `encryption_auth_tag` | Base64 16-byte GCM authentication tag |
| `encryption_key_version` | Positive key-version identifier |
| `status` | `ACTIVE` or `DISABLED` |
| `created_at`, `updated_at` | Microsecond UTC-oriented timestamps |

The unique address key also supplies the required address index. A status index
supports ACTIVE-wallet validation. There is no plaintext private-key or
mnemonic column. The table uses InnoDB and the project's `utf8mb4_unicode_ci`
default, with ASCII binary collations for encoded values and addresses.

Wallet batch creation uses one transaction. A duplicate address is rejected by
the database unique key and translated to a safe repository error. Future
reward and claim schemas remain deferred to their owning phases.

## Phase 3 funding schema

Migration `0002_create_reward_wallet_funding_jobs.sql` adds the operational
funding ledger. It stores deterministic unique job IDs, wallet identity, chain
97, before/target/amount Wei values, Funding Wallet public address, nonce,
signed and broadcast hashes, gas limit, receipt/gas/fee/balance confirmation
data, explicit status/reason/error fields, and lifecycle timestamps.

All potentially uint256-sized values use 78-character ASCII decimal strings and
application bigint conversion. This avoids MariaDB's 65-digit `DECIMAL` limit;
no floating-point type stores Wei. Indexes cover job ID, wallet ID,
wallet address, status, and broadcast hash. A generated nullable
`active_wallet_id` plus a unique key prevents more than one `SIGNED`,
`BROADCAST`, or `PENDING_REVIEW` job for a wallet while allowing any number of
historical terminal jobs. Raw signed transaction bytes and private keys have no
column.

Database passwords remain environment-only and are redacted from logs.
