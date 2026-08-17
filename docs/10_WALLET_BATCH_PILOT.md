# 10-wallet Testnet batch reward pilot

## Scope and safety boundary

The batch runner coordinates the existing single-wallet authorization and claim
lifecycle for an inclusive database wallet-ID range. The first pilot uses IDs
1 through 10, but the range parser and sequential runner are not hardcoded to
ten wallets.

The runner does not create wallets, fund wallets, create campaigns, transfer
IRB inventory, deploy contracts, or change roles. The User Wallet remains the
transaction sender, gas payer, and reward recipient. The Approver only signs
EIP-712 authorization data off-chain.

There is no batch-specific database table. Existing authorization and claim job
rows already contain the durable per-wallet audit and replay evidence. The
reported `batchRunId` identifies one command invocation only and is not a
durable resume cursor. This avoids a second source of claim state while the
pilot is strictly sequential.

## Read-only plan

Keep the tracked/default execution guard false and run:

```bash
npm run claim:batch:plan:test -- \
  --campaign-id 0x8509292576353d7b1173acb5a1a30074fecb8972df178c423389f95b3be2daac \
  --wallet-id-start 1 \
  --wallet-id-end 10 \
  --amount 0.1
```

The plan performs contract, token, native-balance, wallet, authorization, and
claim-job reads. It creates no authorization, decrypts no User Wallet, signs no
data, writes no database row, and sends no transaction. A matching READY
authorization is passed through the normal exact claim planner. When an
authorization is required, gas inspection is limited to the current balance,
gas price, configured maximum, and minimum transaction capability; the exact
`claimReward` estimate is deliberately deferred until a real signed
authorization exists.

## Owner-reviewed execution

Execution is false by default. Use a one-shot environment override only after
reviewing a fresh plan:

```bash
CLAIM_EXECUTION_ENABLED=true \
npm run claim:batch:execute:test -- \
  --campaign-id 0x8509292576353d7b1173acb5a1a30074fecb8972df178c423389f95b3be2daac \
  --wallet-id-start 1 \
  --wallet-id-end 10 \
  --amount 0.1
```

Do not put `CLAIM_EXECUTION_ENABLED=true` in `.env`. The command checks the
guard before opening the database or RPC context. Concurrency is fixed at one;
wallets are planned and, if safe, executed in ascending ID order. Campaign
budget and Reward Contract inventory are refreshed before each new
authorization, and the normal claim plan refreshes all execution state before
signing.

## Statuses

Common wallet actions are:

- `AUTHORIZATION_REQUIRED`: public preflight passed; execution may use the
  existing authorization creation/reissue lifecycle.
- `CLAIM_READY`: a matching READY authorization passed the normal exact claim
  planner.
- `BLOCKED_CLAIM_INTERVAL`: expected skip; no signing or transaction.
- `BLOCKED_INSUFFICIENT_USER_GAS`: expected blocker; no automatic funding.
- `BLOCKED_CAMPAIGN_*`, `BLOCKED_REWARD_CONTRACT_IRB`, or
  `BLOCKED_GAS_PRICE_*`: current safety boundary prevents execution.
- `UNRESOLVED_CLAIM_REQUIRES_RECONCILIATION`: a `SIGNED`, `BROADCAST`, or
  `PENDING_REVIEW` job remains; no replacement is created.
- `AUTHORIZATION_STALE_REQUIRES_RECONCILIATION`: an active authorization no
  longer matches the contract replay nonce.
- `CLAIM_CONFIRMED`: successful receipt, exact `RewardClaimed`, and post-state
  validation completed; authorization consumption occurred through the normal
  atomic confirmation path.
- `CLAIM_PENDING_REVIEW`: transaction outcome is uncertain. The batch stops
  immediately so potentially consumed shared budget is not overcommitted.
- `SYSTEM_ERROR`: infrastructure or persistence safety failure; the batch stops.

`classification` groups these into `READY`, `EXPECTED_BLOCKER`, `SKIPPED`,
`RECONCILIATION_REQUIRED`, `CONFIRMED`, `FAILED`, or `SYSTEM_ERROR`.

## Reconciliation and interruption recovery

Execution invokes the existing claim reconciliation scan once before processing
the range. Each wallet is then checked again for unresolved evidence. A
remaining unresolved job is reported and skipped; it is never rebroadcast and
never replaced by a new nonce or reward ID.

After interruption:

1. keep `CLAIM_EXECUTION_ENABLED` false;
2. run `npm run claim:reconcile:test`;
3. inspect affected authorization jobs with `claim:status:test`;
4. rerun the read-only batch plan for the same range;
5. execute again only after every unresolved or manual-review item is understood.

Confirmed wallets normally become interval-blocked on rerun. Database unique
constraints on authorization job/reward IDs and claim authorization/reward IDs,
combined with contract `rewardNonce` and `usedRewardIds`, remain the idempotency
boundary.

## Inspecting results

The structured summary contains the invocation ID, requested and processed
counts, confirmed/skipped/blocked/reconciliation/failed counts, sent transaction
count, confirmed reward total, estimated and actual gas totals, and safe
per-wallet evidence. Use each `authorizationJobId`, `claimJobId`, and public
transaction hash to correlate with existing job tables and status commands.
No decrypted key, ciphertext, raw signed transaction, Approver key, encryption
key, or RPC credential is included.

## Do not

- Do not alter campaign or claim timestamps to force eligibility.
- Do not manually increment or substitute `rewardNonce` with an Ethereum nonce.
- Do not create a replacement for unresolved signed evidence.
- Do not automatically fund a gas-blocked wallet from this command.
- Do not enable parallel broadcasts for the pilot.
- Do not permanently enable claim execution in `.env`.
- Do not run this workflow on BSC Mainnet.

## Transition to 100 wallets for seven days

The inclusive range already supports more than ten existing wallets, but the
pilot remains concurrency one. Before expanding, add the 100 wallets through an
owner-approved wallet provisioning phase, validate encrypted storage and tBNB
funding separately, size campaign budget and contract inventory, and retain the
same per-wallet state refresh. Introduce a scheduler only as a trigger; contract
claim intervals remain the authorization boundary. Durable batch-run tables,
bounded parallelism, nonce lanes, and automatic scheduling require a separate
design review after sequential pilot evidence is complete.
