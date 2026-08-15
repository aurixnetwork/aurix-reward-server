# Test Campaign execution operations

## Phase 4B-2 boundary

Phase 4B-2 adds owner-gated operational tooling for the approved BSC Testnet
campaign. Development, automated tests, status, and execution preflight send
zero transactions. The actual workflow is refused unless the independent
`CAMPAIGN_EXECUTION_ENABLED` guard is explicitly `true` for the owner-reviewed
execution command.

No wallet is generated. TX 1 reuses the existing Admin/Funding Wallet; TX 2
uses the existing Operations Wallet; TX 3 uses the current IRB Token Owner.
Their private keys remain only in the ignored `.env` or an approved secret
manager and are never logged or persisted.

## Approved parameters

| Parameter | Approved value |
| --- | --- |
| Label | `AURIX_TEST_REWARD_CAMPAIGN_V1` |
| Campaign ID | `0x8509292576353d7b1173acb5a1a30074fecb8972df178c423389f95b3be2daac` |
| Budget | 3 IRB (`3000000000000000000`) |
| Maximum reward | 0.1 IRB (`100000000000000000`) |
| Claim interval | 3,600 seconds |
| Start | latest chain timestamp + 600 seconds, calculated immediately before TX 2 |
| Duration | 604,800 seconds (7 days) |
| End | `startTime + 604800` |
| Active | `true` |
| Reward Contract inventory target | 3.3 IRB (`3300000000000000000`) |

The campaign ID is `keccak256` of the exact UTF-8 label. The absolute
`startTime` is deliberately not stored in tracked configuration or calculated
in advance.

## Exact three-step sequence

The operations are never bundled and later steps do not run while an earlier
required transaction is failed or unresolved.

1. Admin sends only the missing tBNB required for Operations to reach 0.001
   tBNB. If Operations already has at least the target, TX 1 is skipped.
2. Operations calls
   `createCampaign(bytes32,uint256,uint256,uint64,uint64,uint64,bool)`. Before
   signing, the tool rechecks nonexistence, `CAMPAIGN_MANAGER_ROLE`, balance,
   gas, gas-price protection, and pending nonce. A successful receipt is not
   enough: the exact `CampaignCreated` event and all stored fields must match.
3. The IRB Token Owner calls standard ERC-20
   `transfer(AurixRewardClaim, missingInventory)`, where `missingInventory` is
   `max(0, 3.3 IRB - current Reward Contract IRB balance)`. Confirmation
   requires a successful receipt, exact `Transfer` event, and final inventory
   of at least 3.3 IRB.

Each sent operation records its deterministic operation ID, public sender and
payload, signed transaction hash, broadcast hash, receipt, block, gas, fee, and
terminal or unresolved status. Raw signed transactions and keys are never
stored.

## Idempotency and uncertainty

- An Operations balance at or above 0.001 tBNB produces
  `SKIP_TARGET_REACHED` for TX 1.
- An existing campaign matching the approved fixed values and seven-day
  duration produces `SKIP_ALREADY_CREATED`; creation is not attempted again.
- Any existing campaign parameter mismatch stops the workflow for owner review.
- Reward Contract inventory at or above 3.3 IRB produces
  `SKIP_TARGET_REACHED` for TX 3.
- A signed, broadcast, or `PENDING_REVIEW` local operation blocks new execution.
  A timeout or unknown receipt is uncertainty, not failure and not permission
  to sign a replacement.
- A failed receipt stops all subsequent required steps.

## Commands

Read-only execution preflight (always `transactionsSent: 0`):

```bash
npm run campaign:execute:preflight:test
```

Read-only current campaign/inventory/evidence status:

```bash
npm run campaign:status:test
```

The Phase 4B-1 read-only planning command remains available:

```bash
npm run campaign:plan:create:test
```

After database migration, signer configuration, a passing preflight, and a
fresh owner review, the exact future execution command is:

```bash
CAMPAIGN_EXECUTION_ENABLED=true npm run campaign:execute:test
```

Do not run that command during implementation or routine preflight. With the
tracked/default `CAMPAIGN_EXECUTION_ENABLED=false`, `npm run
campaign:execute:test` refuses before opening the execution context.

## Contract facts

`createCampaign` is nonpayable and gated by the exact
`CAMPAIGN_MANAGER_ROLE`. It is not gated by pause state. It validates a nonzero
ID and budget, maximum within budget, increasing uint64 time range, and a claim
interval between 3,600 and 604,800 seconds. Creation initializes `distributed`
to zero and emits `CampaignCreated`.

Creation transfers no IRB and reserves no token inventory. Campaign budget is
an accounting cap; standard IRB transfer funds the Reward Contract. Claims are
separately blocked while the Reward Contract is paused.
