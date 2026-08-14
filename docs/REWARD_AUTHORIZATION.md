# Reward authorization

## Phase 4A boundary

Phase 4A creates and verifies off-chain EIP-712 reward authorizations. It sends
no blockchain transaction. It does not create a campaign, transfer IRB, call
`claimReward()`, change a role, or fund a User Wallet.

The Approver signs authorization data off-chain and pays no gas. In Phase 5 the
claimant User Wallet will sign and submit `claimReward()`, making that wallet the
transaction sender, gas payer, and IRB recipient.

## Canonical typed data

The fixed EIP-712 domain is:

```text
name:              AurixRewardClaim
version:           1
chainId:           97
verifyingContract: 0x355D58c905f42F4f78abCD7413371F6EE4Dba137
```

`RewardAuthorization` uses this exact field order:

```text
claimant     address
amount       uint256
campaignId   bytes32
rewardId     bytes32
rewardNonce  uint256
validAfter   uint256
deadline     uint256
```

The server uses ethers v6 `TypedDataEncoder`, `signTypedData`, and
`verifyTypedData`. Before operational signing it compares the server's canonical
type hash with `REWARD_AUTHORIZATION_TYPEHASH()` on the deployed contract.

## Preparation and lifecycle

An authorization is prepared only after all of these checks succeed:

1. the explicitly selected TEST ELIGIBILITY source allows it;
2. the database User Wallet is `ACTIVE`;
3. chain 97 and the fixed contract/token baseline pass preflight;
4. the contract is unpaused and the campaign exists, is active, and is within
   its time and remaining-budget boundaries;
5. the amount is positive, no larger than `maxRewardAmount`, and fits the
   remaining campaign budget;
6. claimant interval state and `rewardNonce` are read from the contract;
7. the configured authorization window is valid and ends no later than the
   campaign;
8. a unique `rewardId` is persisted in a `PLANNED` database record;
9. the typed-data hash and signature are calculated, the signer is recovered,
   and the expected address is confirmed to hold `APPROVER_ROLE`;
10. the hash and signature are persisted and the job becomes `READY`.

Signing failures leave an explicit `FAILED` record. A `READY` record can later
be independently verified as valid, expired, stale because the contract nonce
changed, malformed, signed by the wrong address, or missing the required role.
`CONSUMED` is reserved for the Phase 5 claim lifecycle.

## Replay and nonce policy

`rewardNonce` is the Reward Contract nonce for `campaignId + claimant`. It is
not an Ethereum transaction nonce and is never guessed or locally incremented.
The create path reads it during planning and immediately re-reads it before
creating the job.

Each `rewardId` is the keccak256 hash of the campaign, claimant, current
contract reward nonce, UUID job identity, and 32 bytes of cryptographically
secure entropy. The database uniquely constrains both `reward_id` and
`campaign_id + claimant_address + reward_nonce`; the create path also checks the
contract's `usedRewardIds` mapping.

## Time and amount policy

`AUTHORIZATION_VALIDITY_SECONDS` is required for plan and create commands and
has no operational default. `validAfter` is the current Unix time in seconds;
`deadline` is `validAfter + AUTHORIZATION_VALIDITY_SECONDS`. Zero, negative,
expired, inverted, unsafe-integer, or campaign-overrunning windows are rejected.
All clock inputs are produced in seconds with `Math.floor(Date.now() / 1000)`;
milliseconds are never placed in the typed data.

Amounts are parsed as decimal IRB with `ethers.parseUnits(value, 18)` and remain
`bigint` base units in the application. JavaScript floating-point arithmetic is
not used.

## Eligibility boundary

Phase 4A includes a `RewardEligibilityService` abstraction and an explicit
`TestRewardEligibilityService`. Its decisions are labeled `TEST_ELIGIBILITY`.
The production implementation is deliberately fail-closed and labeled
`PRODUCTION_ELIGIBILITY`; no medical, activity, or business reward rules have
been invented. Wallet existence alone is not a production eligibility rule.

## Commands

```bash
npm run campaign:inspect:test -- --campaign-id <bytes32>
npm run authorization:plan:test -- --wallet-id 1 --campaign-id <bytes32> --amount <IRB>
npm run authorization:create:test -- --wallet-id 1 --campaign-id <bytes32> --amount <IRB>
npm run authorization:verify:test -- --job-id <uuid>
```

Campaign inspection and authorization planning are read-only. Planning does not
write a job and its preview `rewardId` is not reserved. Creation signs and
persists only after all live checks pass. Verification reconstructs the typed
data independently and performs only contract reads. Every command reports
`transactionsSent: 0`.

If there is no valid on-chain Testnet campaign, planning returns
`BLOCKED_CAMPAIGN_NOT_FOUND`; no campaign is fabricated or created.
