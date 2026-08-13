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

## Optional database settings

`DB_HOST`, `DB_NAME`, and `DB_USER` must be provided together. `DB_PORT` defaults
to `3306`, `DB_CONNECTION_LIMIT` defaults to `10`, and `DB_PASSWORD` may be empty
for an explicitly configured local development database. Blockchain health and
preflight commands do not require a database.

## Keys

There are no Phase 1 private-key variables. Approver, funding, encryption, and
User Wallet keys will be introduced only in their owning phases with separate
validation and storage boundaries.
