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

## Phase 3 Testnet funding

| Variable | Required | Rule |
| --- | --- | --- |
| `TESTNET_FUNDING_PRIVATE_KEY` | funding plan/execution | Dedicated valid EVM private key; never logged |
| `TESTNET_FUNDING_ADDRESS` | no | Optional expected-address assertion; must match the derived address |
| `TEST_WALLET_TARGET_TBNB` | funding plan/execution | Explicit positive decimal tBNB amount, at most 18 decimal places; no default |
| `MAX_FUNDING_GAS_PRICE_GWEI` | no | Positive maximum for observed RPC gas price |
| `FUNDING_EXECUTION_ENABLED` | execution | Must equal `true`; tracked default is `false` |

The Funding Wallet must not match an ACTIVE test User Wallet. Keep it separate
from Approver, Admin/Deployer, and Operations roles. No Approver private key is
loaded or used in Phase 3. The optional minimum-top-up setting is deliberately
omitted in v1; the exact missing-to-target amount is used without alteration.

## Phase 4A reward authorization

| Variable | Required | Rule |
| --- | --- | --- |
| `APPROVER_PRIVATE_KEY` | authorization creation | Valid EVM private key; environment-only and never persisted or logged |
| `APPROVER_ADDRESS` | no | Optional assertion; when present it must be the fixed Testnet Approver and match the address derived from the key |
| `AUTHORIZATION_VALIDITY_SECONDS` | plan/creation | Explicit positive safe integer in Unix seconds; no default |

The fixed expected Approver is
`0x425f7117D36aC8F45224E895e583b404E0a6eb05`. Creation refuses to sign unless
the derived address matches and the address currently holds `APPROVER_ROLE` on
AurixRewardClaim. The key is never written to the database. The Approver signs
off-chain and does not pay claim gas.

Do not configure a production validity policy by inference. Select an explicit
Testnet duration that fits inside the intended campaign's remaining time, then
review it separately before any production use.

## Phase 4B-1 campaign preflight

`campaign:plan:create:test` requires only the existing BSC Testnet RPC and local
database identity settings. The database is read solely to confirm exactly 10
ACTIVE User Wallets. No Admin, Operations, token-owner, Funding, or Approver
private key is loaded or required, and Phase 4B-1 adds no environment variable.

The public role addresses and deterministic proposal are fixed in source for
this Testnet preflight. Proposed start/end timestamps are derived from the latest
block timestamp on each invocation and are not persisted or approved by running
the command.

## Phase 4B-2 campaign execution

| Variable | Required | Rule |
| --- | --- | --- |
| `TESTNET_FUNDING_PRIVATE_KEY` | only when TX 1 is required | Reused as fixed Admin signer; must derive to `0x2A37820df48d298De3907557b02301A46C2e127f` |
| `OPERATIONS_PRIVATE_KEY` | only when TX 2 is required | Existing Operations key; must derive to its fixed address |
| `OPERATIONS_ADDRESS` | defaulted | Must equal `0x9B2fB8ED115242477C9a8Ea511a0D85E122E1FbE` |
| `IRB_TOKEN_OWNER_PRIVATE_KEY` | only when TX 3 amount is nonzero | Existing current IRB Token Owner key; must derive to its fixed address |
| `IRB_TOKEN_OWNER_ADDRESS` | defaulted | Must equal `0xD0801a18cF74893B12849A6f2E7b4E469b5FFc89` |
| `MAX_CAMPAIGN_GAS_PRICE_GWEI` | no | Positive maximum independently applied to each workflow transaction |
| `CAMPAIGN_EXECUTION_ENABLED` | execution | Must explicitly equal `true`; tracked/default value is `false` |

The campaign guard is independent from `FUNDING_EXECUTION_ENABLED`. The
read-only execution preflight reports missing or mismatching signer
configuration as failed checks while sending zero transactions. Execution
derives and validates only the signers required by live planned actions. A
target-satisfied step reports `SKIPPED_NOT_REQUIRED`; its signer key may be
absent without blocking preflight or execution. Never add a real key to
`.env.example` or tracked content.

## Phase 5 claim execution

| Variable | Required | Rule |
| --- | --- | --- |
| `MAX_CLAIM_GAS_PRICE_GWEI` | no | Positive maximum for the observed claim gas price |
| `CLAIM_EXECUTION_ENABLED` | execution only | Must explicitly equal `true`; tracked/default value is `false` |

Planning and status require database/RPC configuration but no signer secret.
Guarded execution additionally requires `WALLET_ENCRYPTION_KEY` at the encrypted
record's version. The User Wallet key is decrypted only after the guard and a
fully executable public-state plan. Funding, Approver, Admin, Operations, and
token-owner private keys are neither required nor accepted as claim senders.

The claim guard is independent of funding and campaign guards. Phase 5A keeps
all three false. The engine uses a fixed 20% gas-limit margin and never tops up
the claimant; run the separate funding plan when gas is insufficient.
