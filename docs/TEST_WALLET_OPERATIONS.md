# Test User Wallet operations

## Preconditions

Use only `feature/testnet-reward-server-v1` or a reviewed descendant. Configure
an untracked `.env` with the fixed BSC Testnet baseline, a reachable local/test
MariaDB or MySQL database, and the wallet encryption settings described in
[Configuration](CONFIGURATION.md). Never use an Admin/Deployer, Approver,
Operations, or Funding wallet as a test User Wallet.

Back up the encryption key in an approved secret manager before creating
wallets. Losing it may make every encrypted private key unrecoverable.

## Prepare the database

```bash
npm run db:migrate
```

The migration is additive and checksum-pinned. Review the command result before
continuing.

## Create wallets

```bash
npm run wallets:create:test -- --count 10
```

The default count is 10. The accepted range is 1 through 100. The command first
validates configuration, database connectivity, and the encryption key. The
requested batch is one database transaction: every generated private key is
encrypted immediately, every inserted record is reloaded and decrypted once,
and all inserts commit only after all address checks pass. A failure rolls back
the entire batch; no partially committed batch is reported.

Output contains only wallet sequence number, database ID, public address, and
status. It never contains a private key, mnemonic, ciphertext, IV,
authentication tag, or encryption key.

The command does not check whether ten wallets already exist. Running it again
intentionally creates another batch of unique wallets. Check the public list
before deciding to create more.

## List public metadata

```bash
npm run wallets:list:test
```

This command selects and displays only database ID, public address, status, and
creation time. It never selects encrypted columns.

## Validate encrypted records

```bash
npm run wallets:validate:test
```

The validator loads ACTIVE records, selects the configured key version,
authenticates and decrypts each record, derives its ethers address, and reports
`PASS` or `FAIL` per public address. A healthy initial ten-wallet set ends with:

```text
10 validated
0 failed
```

Any failure makes the command unsuccessful. Do not disable, replace, or export a
failed record until its database row, configured key version, and secret backup
have been investigated through a private operational channel.

All three commands are local/database operations. They create no provider or
signer and send zero blockchain transactions.

## Assess tBNB gas balances

After Phase 2 validation, configure a separate Funding Wallet and an explicit
target in the ignored `.env`, apply migration `0002`, then run:

```bash
npm run funding:plan:test
```

This reads public wallet rows and on-chain tBNB balances only. It requires
exactly the existing ten ACTIVE wallets and never decrypts their private keys.
Review current balances, exact top-ups, gas estimate, unresolved jobs, and whole-
batch Funding Wallet sufficiency. The result must report `transactionsSent: 0`.

Use `npm run funding:status:test` to inspect persisted public job state. Do not
run `funding:execute:test` as part of planning or automated validation. That
command is reserved for separately approved operation and refuses to broadcast
unless `FUNDING_EXECUTION_ENABLED=true`. See [tBNB funding](TBNB_FUNDING.md).
