# Test Campaign creation preflight

## Phase 4B-1 boundary

Phase 4B-1 is read-only. It proposes and validates a first Testnet campaign but
does not create it, transfer IRB or tBNB, create an authorization, call
`claimReward()`, or modify any role or pause state. The proposal remains
`RECOMMENDED_NOT_APPROVED` until an owner explicitly approves later execution.

The contract repository source at `ad1fec6e3b6119eb021db9fed4c47ddc08ca3213`
has no difference in the contract, interface, or ABI from deployed source commit
`71bfbfa4252430bda6c907e5a7e78bedfa175116`. The server and contract ABI files
are byte-identical with SHA-256
`36eb89b5d3194d3ca82ca46430bec53310067d3fb60223315dbc9ae29abe1c21`.

## Exact creation interface

```solidity
function createCampaign(
    bytes32 campaignId,
    uint256 budget,
    uint256 maxRewardAmount,
    uint64 startTime,
    uint64 endTime,
    uint64 claimInterval,
    bool active
) external onlyRole(CAMPAIGN_MANAGER_ROLE)
```

The function is nonpayable and has no `whenNotPaused` modifier. It sends no
token and reads no token balance. Calls revert as follows:

- `AccessControlUnauthorizedAccount(account, CAMPAIGN_MANAGER_ROLE)` when the
  caller lacks the exact role;
- `ZeroCampaignId()` for `bytes32(0)`;
- `CampaignAlreadyExists(campaignId)` when the permanent `exists` flag is true;
- `InvalidCampaignBudget(budget)` when budget is zero;
- `InvalidCampaignMaximum(maximum, budget)` when the maximum is zero or greater
  than the budget;
- `InvalidCampaignTimeRange(startTime, endTime)` unless `startTime < endTime`;
- `InvalidClaimInterval(interval)` outside 3,600 through 604,800 seconds.

There is no rule requiring `startTime` to be in the future. Successful creation
sets `distributed = 0`, stores all supplied values, sets `exists = true`, and
emits:

```solidity
CampaignCreated(
    campaignId,
    budget,
    maxRewardAmount,
    startTime,
    endTime,
    claimInterval,
    active
)
```

The caller supplies `campaignId`; the contract does not generate it. No delete
or existence-reset function exists, so an ID must be unique and can never be
reused after successful creation.

## Campaign changes and pause behavior

`CAMPAIGN_MANAGER_ROLE` also gates `setCampaignActive`,
`setCampaignClaimInterval`, `setCampaignMaxRewardAmount`, `setCampaignBudget`,
and `setCampaignEndTime`. All require an existing campaign. Interval and maximum
updates retain creation bounds. A new budget must be nonzero and cannot fall
below either `distributed` or the current maximum. An end-time update must
remain after the immutable start time.

Campaign creation and updates remain callable while paused. `pause()` requires
`PAUSER_ROLE`; `unpause()` requires `DEFAULT_ADMIN_ROLE`. Claims require the
contract to be unpaused.

## Deterministic Test Campaign ID

```text
source label: AURIX_TEST_REWARD_CAMPAIGN_V1
derivation:   keccak256(UTF-8 source label)
campaignId:   0x8509292576353d7b1173acb5a1a30074fecb8972df178c423389f95b3be2daac
```

The label is canonical, readable, and reproducible; no randomness is used. The
public `campaigns(bytes32)` mapping currently reports `exists = false` for this
ID. The contract has no campaign count, ID array, or enumeration function.
Historical IDs can only be reconstructed from `CampaignCreated` logs.

## Recommended proposal

| Parameter | Proposal | Reason |
| --- | --- | --- |
| Label | `AURIX_TEST_REWARD_CAMPAIGN_V1` | Explicit first technical Testnet campaign |
| Wallet scope | 10 ACTIVE User Wallets | Matches the fixed current server scope |
| Budget | 3 IRB (`3000000000000000000`) | 0.1 IRB × 10 wallets × 3 complete rounds |
| Maximum per claim | 0.1 IRB (`100000000000000000`) | Small but exactly observable 18-decimal transfer |
| Start | latest execution block timestamp + 86,400 seconds | One-day review/funding window after creation |
| Duration | 604,800 seconds (7 days) | Allows controlled retries and later multiple rounds |
| Claim interval | 3,600 seconds (1 hour) | Deployed minimum; permits three deliberate test rounds |
| Active | `true` | No separate activation transaction; future start prevents early claims |

These are recommendations, not finalized operational values. The start/end
timestamps must be recalculated and reviewed immediately before a later create
transaction.

One complete round needs 1 IRB. Three rounds need the full 3 IRB campaign
budget. A 10% operational buffer is 0.3 IRB, so the recommended Reward Contract
balance is 3.3 IRB. Its current balance is zero; required top-up is exactly 3.3
IRB (`3300000000000000000` base units).

## Token funding semantics

Campaign creation transfers no token and does not require the Reward Contract
to be funded. There is no deposit or fund function. Funding uses the standard
IRB `transfer(RewardContract, amount)` operation.

`budget` is a per-campaign accounting limit, not reserved token inventory.
Consequently, total campaign budgets may exceed both the Reward Contract's IRB
balance and each other. At claim time the contract first checks campaign
remaining budget and then checks its actual IRB balance. Insufficient inventory
reverts with `InsufficientRewardTokenBalance(balance, required)` and all claim
state changes roll back.

`TREASURY_ROLE` can call `withdrawRewardToken(recipient, amount)` only while the
contract is paused, for a nonzero recipient/amount no greater than the current
IRB balance. It does not reserve active campaign budgets. The same role may call
`recoverUnrelatedToken` while paused, but that function explicitly rejects IRB.

Read-only balance inspection found the current IRB token owner
`0xD0801a18cF74893B12849A6f2E7b4E469b5FFc89` holds
19,989,990,350.01 IRB and could fund the proposal if its owner approves. The
Reward Contract, Admin, Operations, and Approver each currently hold zero IRB.

## Proposed later transaction order

The safe order uses the delayed start and the fact that creation does not need
pre-funding:

1. Admin sends Operations enough native tBNB to reach a 0.001 tBNB gas target.
   This is a normal native transfer, requires no contract role, and changes no
   Reward Contract state.
2. Operations calls the exact `createCampaign(...)` function. Operations must
   hold `CAMPAIGN_MANAGER_ROLE`; Admin's `DEFAULT_ADMIN_ROLE` does not inherit
   campaign creation permission. Expected event: `CampaignCreated`.
3. The approved IRB owner calls `IRB.transfer(RewardContract, 3.3 IRB)` before
   the one-day-delayed start. No Reward Contract role is required. Expected
   event: IRB `Transfer`.

At the observed 0.1 gwei gas price, the read-only estimates were 21,000 gas for
the native top-up, approximately 100,515 gas for creation, and 56,785 gas for
the IRB transfer: approximately 178,300 gas and 0.00001783 tBNB in fees total.
The top-up additionally moves 0.001 tBNB from Admin to Operations. Gas and
timestamps must be re-estimated immediately before later execution.

## Planning command

```bash
npm run campaign:plan:create:test
```

The command validates chain and contracts, counts ACTIVE database wallets,
reads the public campaign mapping, role assignments, deployed interval
constants, pause state, token owner and balances, native balances and gas price,
and estimates the three proposed transactions. It uses no private key, writes no
database record, creates no raw transaction, and always reports
`transactionsSent: 0`.

No campaign registry table is added in Phase 4B-1. The proposal is deterministic
code/documentation and the blockchain remains the sole source of truth. A local
registry becomes useful only when a later phase has a real create transaction
hash and operational lifecycle to persist.
