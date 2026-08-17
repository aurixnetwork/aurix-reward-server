# Production Reward Runs

## Durable state

`reward_runs` is the authoritative aggregate: Run/Campaign/policy, amount,
dispatch interval, target/progress, result counters, transactions, total
AURX/BNB gas, current sequence, status, and lifecycle timestamps. Statuses are
`DRAFT`, `READY`, `RUNNING`, `PAUSED`, `COMPLETED`,
`COMPLETED_WITH_EXCEPTIONS`, `STOPPED`, and `FAILED`.

`reward_run_items` stores one intended Wallet operation. Unique keys enforce one
Item per `(runId, campaignId, walletId)`, sequence uniqueness, and unique links
to Authorization/Claim jobs. Generated guards reserve FIRST_REWARD and
ONCE_PER_CAMPAIGN work while eligible, active, or confirmed. Existing Claim and
Authorization constraints are unchanged.

The Initial Reward uses a stable `policyScope`. Only a Claim with successful
receipt, matching `RewardClaimed`, validated post-state, and `CONFIRMED` state is
successful history. A token balance never proves eligibility. `SIGNED`,
`BROADCAST`, and `PENDING_REVIEW` block new execution pending reconciliation.

Policies are:

- `FIRST_REWARD_ONLY`: once in the designated Initial Reward scope.
- `ONCE_PER_CAMPAIGN`: once in that Campaign; unrelated Campaigns do not count.
- `RECURRING`: repeated Claims only when DB eligibility and all contract interval,
  nonce, authorization, and Campaign rules pass.

## Administration

After reviewed Campaign metadata and Mainnet Wallet import:

```text
npm run mainnet:run:admin -- create --run-id <id> --campaign-operation-id <id> --wallet-id-start <n> --wallet-id-end <n>
npm run mainnet:run:admin -- start  --run-id <id>
npm run mainnet:run:admin -- pause  --run-id <id>
npm run mainnet:run:admin -- resume --run-id <id>
npm run mainnet:run:admin -- stop   --run-id <id>
```

These are DB controls, not blockchain transactions. Creation validates Mainnet
designation, distinct Wallets, history/reservations, and safety ceilings. This
implementation task does not invoke these commands.

Pause prevents a new Wallet starting. Existing uncertain state remains
reconcilable. Resume ignores finalized confirmed/skipped Items, reconciles
recovery work first, and continues untouched Items without duplication.

## Persistence, output, and recovery

For each Wallet the dispatcher acquires leases, evaluates history, invokes the
existing Claim engine, atomically finalizes Item evidence, Run counters, and
Campaign `nextDispatchAt`, and only then prints the required human-readable
result. Confirmed, skipped, blocked, reconciliation, failed, and system outcomes
are durable before display. Structured output remains secret-safe.

The final Summary contains aggregates only, never the Item array. Detailed
evidence remains in DB and live per-Wallet output. DappBay evidence contains
run/chain/contract/Campaign/policy/pacing, distinct claimants, confirmed hashes
and blocks, rewardNonce, reward totals, gas, and timestamps.

Recovery states (`ACQUIRED`, `AUTHORIZED`, `SIGNED`, `BROADCAST`,
`PENDING_REVIEW`) are selected before new work. Authorization state is
rediscovered in DB. Signed/broadcast state uses the existing known-hash
reconciler. Confirmed Items finalize; unresolved Items remain review-required.
There is no blind retry or retry of a confirmed reward.

The row-by-row model supports 100, 1,000, 10,000, and 16,000+ Wallets without
retaining all results in memory. A crash at Item 5,437 leaves prior commits
durable.
