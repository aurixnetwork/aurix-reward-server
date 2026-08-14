# BSC Testnet tBNB funding

## Purpose and boundary

Phase 3 keeps exactly the existing ten ACTIVE test User Wallets supplied with
enough BSC Testnet native token to pay for later self-claim gas. It never sends
IRB, creates a campaign, or executes `claimReward()`. BSC Mainnet is rejected by
the fixed chain ID 97 validation.

The Funding Wallet is a dedicated Testnet sender. It must not be a test User
Wallet, Approver, Admin/Deployer, Operations Wallet, or production wallet. The
runtime derives its address from `TESTNET_FUNDING_PRIVATE_KEY`; the optional
`TESTNET_FUNDING_ADDRESS` is only an assertion. A mismatch, malformed key, or
collision with any ACTIVE test User Wallet aborts the command. No Funding Wallet
secret or raw signed transaction is persisted or printed.

## Target-balance policy

`TEST_WALLET_TARGET_TBNB` is mandatory and has no default. It is parsed with
`ethers.parseEther()` and represented as bigint Wei. For every wallet:

```text
topUp = max(targetBalance - currentOnChainBalance, 0)
```

A wallet at or above target is skipped. Only the missing amount is ever placed
in a transaction. Phase 3 does not implement a minimum-transfer threshold: the
exact target calculation is simple, deterministic, and avoids silently leaving
a wallet below target.

## Commands

```bash
npm run funding:plan:test
npm run funding:status:test
npm run funding:execute:test
```

`funding:plan:test` is read-only. It validates RPC and chain 97, checks the fixed
Reward Contract and IRB bytecode/reward-token baseline, derives and checks the
Funding Wallet, loads exactly ten ACTIVE database wallets, checks
balances and unresolved jobs, observes the RPC legacy gas price, estimates each
native transfer, and reports batch sufficiency. It always ends with
`transactionsSent: 0`.

`funding:status:test` reads persisted jobs and reports safe counts and public
operational fields. `funding:execute:test` is implemented for a separately
reviewed operation only. It refuses to run unless the untracked environment
contains `FUNDING_EXECUTION_ENABLED=true`. The tracked example remains `false`.

## Gas and all-or-nothing preflight

Native transfers use the RPC-observed legacy `gasPrice`; no gas price is
hardcoded. Each transfer is estimated and its gas limit receives a 10% safety
margin. `MAX_FUNDING_GAS_PRICE_GWEI`, when set, blocks execution above that
observed price. The complete batch liability is:

```text
sum(exact top-ups) + sum(safety-adjusted gas limits × observed gas price)
```

The Funding Wallet balance must cover the whole selected batch. Otherwise the
worker aborts before signing or broadcasting the first transaction. Partial
funding is not the Phase 3 default.

## Job lifecycle and idempotency

The current on-chain wallet balance remains the source of truth. A previous
`CONFIRMED` job does not prevent a later top-up after the wallet spends tBNB.
`SIGNED`, `BROADCAST`, and `PENDING_REVIEW` are unresolved. The database has a
generated unique guard that permits at most one unresolved job per wallet.

Execution is sequential from
`getTransactionCount(fundingWallet, "pending")`. Immediately before each send,
the worker rechecks the recipient balance. It skips a newly sufficient wallet;
if an initially sufficient wallet unexpectedly falls below target, it records a
replan-required skip instead of adding an unbudgeted transaction mid-batch.

For a transaction the order is:

1. build with chain ID 97, exact value, observed gas price, estimated gas limit,
   and the next sequential nonce;
2. sign locally and compute the signed transaction hash;
3. persist the job and hash as `SIGNED`;
4. broadcast those exact signed bytes;
5. persist `BROADCAST` and the returned matching hash;
6. verify a successful receipt and read the recipient balance again;
7. persist `CONFIRMED`, block, receipt summary, gas, effective price, fee, and
   balance after.

A reverted receipt becomes `FAILED`. A broadcast or receipt timeout is not
treated as transaction failure; it becomes `PENDING_REVIEW`. Restart
reconciliation checks both signed and broadcast hashes for a transaction and
receipt. It can confirm success, record a revert, or leave the job unresolved.
Phase 3 never creates an automatic replacement transaction. Any future
replacement must retain all hashes and reuse the original nonce.

Read calls fail over across the healthy primary/secondary pool. Broadcast
failover may submit the same raw signed bytes to a healthy secondary after
an inconclusive primary call. It never signs a different transaction merely
because an RPC call timed out, so transaction hash identity is preserved.
