# Configuration

Copy `.env.example` to the ignored `.env` and set the primary RPC URL. Do not
commit `.env`.

## Blockchain settings

| Variable | Required | Rule |
| --- | --- | --- |
| `BSC_TESTNET_RPC_URL` | yes | Valid HTTP(S) RPC URL |
| `BSC_TESTNET_RPC_URL_SECONDARY` | no | Failover RPC URL |
| `BSC_TESTNET_CHAIN_ID` | defaulted | Must equal `97` |
| `RPC_TIMEOUT_MS` | defaulted | 1,000–30,000 ms; default 10,000 |
| `AURIX_REWARD_CONTRACT_ADDRESS` | defaulted | Must equal the fixed testnet Reward Contract |
| `IRB_TEST_TOKEN_ADDRESS` | defaulted | Must equal the fixed IRB test token |

Endpoint URLs may embed provider credentials. Commands and logs expose only the
labels `primary` and `secondary`.

## Runtime settings

`NODE_ENV` accepts `development`, `test`, or `production`. `LOG_LEVEL` accepts
the standard Pino levels from `fatal` through `trace`, plus `silent`.

## Database settings

`DB_HOST`, `DB_NAME`, and `DB_USER` must be provided together. `DB_PORT` defaults
to `3306`, `DB_CONNECTION_LIMIT` defaults to `10`, and `DB_PASSWORD` may be empty
for an explicitly configured local development database. Blockchain health and
preflight commands do not require a database. Phase 2 wallet commands require
all three identity fields and verify connectivity before doing any work.

## Test User Wallet encryption

| Variable | Required | Rule |
| --- | --- | --- |
| `WALLET_ENCRYPTION_KEY` | for wallet commands | Canonical padded Base64 encoding of exactly 32 random bytes |
| `WALLET_ENCRYPTION_KEY_VERSION` | defaulted | Positive integer; Phase 2 default is `1` |

Keep the real value only in the ignored `.env` and an approved secret manager.
One local way to generate it without displaying it in the terminal is the
following explicit command. It writes a new mode-restricted file under the
Git-ignored `private/` directory and refuses to overwrite an existing file:

```bash
install -d -m 700 private
(set -o noclobber; umask 077; node --input-type=module -e 'import { randomBytes } from "node:crypto"; process.stdout.write(randomBytes(32).toString("base64") + "\n")' > private/wallet-encryption-key.txt)
```

Move the value into `.env` through a private editor or secret-management
workflow; do not paste it into a command argument. Securely retain the approved
backup. If the key is lost, encrypted wallet keys may be unrecoverable. The
generation command is never run automatically and never overwrites an existing
file.

Approver and Funding private keys are not Phase 2 settings. They must remain
separate when introduced in later phases.
