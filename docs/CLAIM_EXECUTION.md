# Claim execution

## Phase 5A boundary

Phase 5A implements planning, guarded execution, status, receipt validation, and
restart reconciliation for claimant-funded reward claims. Development and
validation of Phase 5A sends zero blockchain transactions.

`claim:plan:test`, `claim:status:test`, and `claim:reconcile:test` are read-only
with respect to the blockchain. `claim:execute:test` refuses to sign or
broadcast unless the independent `CLAIM_EXECUTION_ENABLED=true` guard is set.
The tracked value remains `false`.

## Exact deployed interface

The canonical Solidity declaration is:

```solidity
function claimReward(
    RewardAuthorization calldata authorization,
    bytes calldata approverSignature
) external;
```

The canonical ABI signature is:

```text
claimReward((address,uint256,bytes32,bytes32,uint256,uint256,uint256),bytes)
```

The tuple fields are, in order:

```text
claimant, amount, campaignId, rewardId, rewardNonce, validAfter, deadline
```

`approverSignature` is the dynamic ABI `bytes` argument containing the canonical
ECDSA signature returned by ethers v6 `signTypedData` (65 bytes: `r || s || v`).
It is not a transaction signature. The function is nonpayable.

The deployed source first applies `whenNotPaused` and `nonReentrant`, then checks
claimant/nonzero fields, `msg.sender == claimant`, global reward-ID use,
campaign/claimant reward nonce, authorization window, campaign existence and
activity/window, claim interval, maximum reward, remaining budget, Reward
Contract token inventory, and finally EIP-712 signer recovery/current
`APPROVER_ROLE`. It then consumes replay state, updates campaign accounting,
transfers IRB, and emits:

```solidity
event RewardClaimed(
    bytes32 indexed campaignId,
    bytes32 indexed rewardId,
    address indexed claimant,
    address approver,
    uint256 amount,
    uint256 consumedRewardNonce,
    uint256 claimTimestamp
);
```

Claim-relevant custom errors are `EnforcedPause`, `ReentrancyGuardReentrantCall`,
`ZeroAddress`, `ClaimantMismatch`, `ZeroAmount`, `ZeroCampaignId`,
`ZeroRewardId`, `RewardIdAlreadyUsed`, `InvalidRewardNonce`,
`InvalidAuthorizationWindow`, `AuthorizationNotYetValid`,
`AuthorizationExpired`, `CampaignDoesNotExist`, `CampaignInactive`,
`CampaignNotStarted`, `CampaignEnded`, `ClaimIntervalNotElapsed`,
`RewardExceedsMaximum`, `CampaignBudgetExceeded`,
`InsufficientRewardTokenBalance`, ECDSA signature errors, `InvalidApprover`, and
token transfer errors such as `SafeERC20FailedOperation`.

## Sender and key model

```text
READY RewardAuthorization
        |
public-state preflight (no secret needed)
        |
load encrypted claimant User Wallet
        |
AES-256-GCM decrypt + derive ethers address
        |
require derived == stored == authorization claimant
        |
User Wallet signs claimReward transaction
        |
persist SIGNED hash
        |
broadcast identical signed bytes
```

The User Wallet is `transaction.from`, Solidity `msg.sender`, gas payer, and IRB
recipient. The Approver only signs EIP-712 data off-chain and pays no gas. Admin,
Operations, Funding, IRB Token Owner, and Approver keys are never eligible claim
transaction senders.

The encrypted record's ciphertext, IV, authentication tag, and key version are
loaded only for guarded execution. AES-GCM authentication and derived-address
validation run before signing. Plaintext key material is neither logged nor
persisted. Planning uses the public wallet projection and never decrypts.

## Fresh preflight and gas

Immediately before signing, the engine fails closed unless all required
conditions match current chain state: chain 97; both fixed bytecodes;
`rewardToken` equals fixed IRB; unpaused contract; existing active in-window
campaign; positive amount within maximum, budget, and inventory; READY and
currently valid authorization; unused reward ID; exact current contract
`rewardNonce`; ACTIVE matching wallet; canonical hash/signature; recovered
expected signer with current `APPROVER_ROLE`; and elapsed claim interval.

The planner reads the latest block timestamp, claimant tBNB/IRB balances,
Reward Contract IRB balance, observed legacy gas price, and pending Ethereum
transaction nonce. It simulates exact calldata with `eth_estimateGas`, adds a
fixed 20% gas-limit safety margin, and requires claimant tBNB to cover
`gasLimit * gasPrice`. `MAX_CLAIM_GAS_PRICE_GWEI` can impose an additional
ceiling. Insufficient gas returns `BLOCKED_INSUFFICIENT_USER_GAS`; the claim
engine never performs an automatic top-up.

## Two independent nonces

`rewardNonce` is contract replay state for `campaignId + claimant`. It is always
read from AurixRewardClaim and must equal the signed authorization. It is stored
as an exact uint256-sized decimal string.

The Ethereum transaction nonce belongs to the claimant account and is read with:

```text
provider.getTransactionCount(claimant, "pending")
```

It is used only in the blockchain transaction and stored separately as
`tx_nonce`. Neither nonce is derived from the other.

## Idempotency and lifecycle

The database uniquely constrains `authorization_job_id` and `reward_id`, so one
READY authorization cannot create independent claim jobs. Planning checks the
database and `usedRewardIds` before signing. `SIGNED`, `BROADCAST`, or
`PENDING_REVIEW` means reconcile the known hash; it never means allocate a new
Ethereum nonce. A confirmed job returns `SKIP_ALREADY_CONFIRMED`. An on-chain
used reward ID routes to reconciliation rather than resend.

Claim `SIGNED` persistence locks the exact authorization row and requires it to
remain `READY`. Authorization expiration/reissuance takes the same row lock and
checks unresolved claims inside its transaction. Thus a claim cannot become
unresolved between the reissuance check and expiration. A fresh authorization
for the same contract reward nonce has a new authorization job ID and reward ID,
so existing claim uniqueness and confirmation consumption remain scoped to the
exact authorization used.

The crash-safe lifecycle is:

1. complete current preflight;
2. read the pending Ethereum transaction nonce;
3. encode exact `claimReward` calldata and estimate gas;
4. decrypt and address-validate only the claimant wallet;
5. sign locally and calculate the transaction hash;
6. persist the job as `SIGNED` without raw signed bytes;
7. broadcast the identical bytes and persist `BROADCAST`;
8. obtain a successful receipt;
9. require exactly one matching `RewardClaimed` event;
10. validate every event field, exact IRB balance deltas, campaign distributed
    delta, reward-nonce increment, reward-ID use, and `lastClaimAt`;
11. atomically persist `CONFIRMED` and mark the authorization `CONSUMED`.

Raw signed bytes are memory-only in v1. If a process stops after `SIGNED` but
before an accepted broadcast, restart reconciliation looks up the persisted
hash but cannot recreate or resend the raw bytes. That state stays unresolved
for operator review; the server must not create a different transaction.

## RPC uncertainty and reconciliation

Fallback broadcast is allowed only with the exact same signed bytes, preserving
hash and nonce identity. A timeout becomes `PENDING_REVIEW`, never `FAILED` and
never permission for a replacement. Phase 5A implements no automatic
replacement transaction.

Reconciliation scans `SIGNED`, `BROADCAST`, and `PENDING_REVIEW`, looks for the
known hash and receipt across healthy endpoints, verifies the exact event and
post-state, and finalizes only valid evidence. It also checks transaction
visibility, reward-ID use, and nonce movement. A reverted receipt becomes
`FAILED`; missing or contradictory evidence remains `PENDING_REVIEW`.

## Safe execution diagnostics

Pre-broadcast execution failures use `ClaimExecutionError`, whose message is
selected only from a fixed safe-message table. The command logger exposes only
its `type`, `code`, and safe message. Generic `Error` continues to expose only
its type, so arbitrary provider, signer, database, SQL, or environment error
text is not logged.

Safe codes are `CLAIM_EXECUTION_DISABLED`, `CLAIM_AUTHORIZATION_NOT_FOUND`,
`CLAIM_PLAN_NOT_EXECUTABLE`, `CLAIM_TRANSACTION_INCOMPLETE`,
`CLAIM_WALLET_INVALID`, `CLAIM_ENCRYPTION_VERSION_MISMATCH`,
`CLAIM_NONCE_MISSING`, `CLAIM_CAMPAIGN_STATE_MISSING`,
`CLAIM_SIGNING_FAILED`, and `CLAIM_SIGNED_PERSIST_FAILED`. Database-driver
details are discarded when persistence failures are wrapped; SQL, key material,
encrypted wallet fields, and environment values are never copied into the safe
error.

## Authorization consumption policy

Only exact confirmed-claim persistence changes an authorization from `READY` to
`CONSUMED`, in the same database transaction as the claim confirmation. Signing,
broadcast, timeout, or a successful receipt with invalid evidence is not enough.
A reverted claim leaves the authorization `READY`. Before its deadline, that
active row still blocks duplicate issuance. After its deadline, the explicit
authorization lifecycle may replace it only when the contract nonce is still
unchanged, the old reward ID remains unused, and no unresolved claim exists;
otherwise reconciliation or operator review remains mandatory.

## Commands

```bash
npm run claim:plan:test -- --authorization-job-id <uuid>
npm run claim:execute:test -- --authorization-job-id <uuid>
npm run claim:status:test -- --authorization-job-id <uuid>
npm run claim:reconcile:test
```

The authorization job must be fresh; Phase 5 does not depend on a hardcoded
Phase 4C job. Keep `CLAIM_EXECUTION_ENABLED=false` during Phase 5A validation.
