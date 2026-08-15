# Contract integration

## Canonical ABI provenance

`src/contracts/abi/AurixRewardClaim.json` is an unmodified byte-for-byte copy of:

- Repository: `https://github.com/aurixnetwork/aurix-reward-contract`
- Path: `abi/AurixRewardClaim.json`
- Source repository commit: `ad1fec6e3b6119eb021db9fed4c47ddc08ca3213`
- Git blob: `b230b5fc9ad3cc51f1dea964e471eba03ce5d356`
- SHA-256: `36eb89b5d3194d3ca82ca46430bec53310067d3fb60223315dbc9ae29abe1c21`
- Deployed Reward Contract: `0x355D58c905f42F4f78abCD7413371F6EE4Dba137`

The ABI hash is enforced by a deterministic test. Update it only after an
explicitly reviewed canonical contract release; never hand-edit the copied ABI.

## Read surface

The Reward Contract client reads `rewardToken()`, `paused()`, `eip712Domain()`,
`eip712Name()`, and `eip712Version()`. Phase 4A also uses the ABI's exact
`getCampaign`, `getRewardNonce`, `getLastClaimAt`, `getNextClaimAt`,
`isClaimIntervalElapsed`, `usedRewardIds`, `REWARD_AUTHORIZATION_TYPEHASH`,
`APPROVER_ROLE`, and `hasRole` methods. The wrapper holds a provider only,
exposes no generic Contract, and implements no write method.

The IRB client uses a minimal ERC-20 read ABI for `name`, `symbol`, `decimals`,
`totalSupply`, and `balanceOf`.

## Preflight invariants

Preflight refuses success unless the connected chain is 97, both addresses have
bytecode, `rewardToken()` equals the fixed IRB address, token metadata is
IRISBANK/IRB/18, the pause state is readable, and the EIP-712 domain is
AurixRewardClaim/version 1/chain 97/the fixed verifying contract. RPC URLs are
not included in its result.

## Campaign and authorization model

`getCampaign(bytes32)` returns budget, distributed amount, maximum reward,
start/end Unix times, claim interval, active state, and existence. The campaign
inspect command reports a missing campaign cleanly and never creates one.
The client uses the public `campaigns(bytes32)` getter for non-reverting
existence inspection because `getCampaign(bytes32)` deliberately reverts with
`CampaignDoesNotExist` when absent. Campaign enumeration is not implemented by
the contract.

The canonical EIP-712 type is:

```text
RewardAuthorization(address claimant,uint256 amount,bytes32 campaignId,bytes32 rewardId,uint256 rewardNonce,uint256 validAfter,uint256 deadline)
```

`rewardNonce` is read for the claimant and campaign from the contract. It is not
the User Wallet's transaction nonce. The signing path compares the canonical
type hash to the deployed public constant and checks the recovered signer has
`APPROVER_ROLE`; these are read-only calls. See
[Reward authorization](REWARD_AUTHORIZATION.md).

## Campaign writes and token inventory

The exact creation function is
`createCampaign(bytes32,uint256,uint256,uint64,uint64,uint64,bool)` and is gated
only by `CAMPAIGN_MANAGER_ROLE`; it is not gated by pause state. Creation stores
accounting parameters and emits `CampaignCreated`, but transfers no IRB and
does not verify the contract balance.

There is no deposit function. Standard IRB `transfer` funds the Reward Contract.
Campaign budgets are independent accounting caps rather than token
reservations, so claim execution separately enforces actual IRB balance. See
[Test Campaign creation preflight](TEST_CAMPAIGN.md) for exact constraints,
treasury behavior, and the non-executed Testnet proposal.

## Phase 4B-2 write validation

The separate owner-gated campaign execution service uses the pinned canonical
ABI to encode `createCampaign` and validate `CampaignCreated`. It uses a minimal
standard ERC-20 ABI to encode IRB `transfer` and validate `Transfer`. The
provider-only contract clients remain read surfaces.

Each approved operation is locally signed and independently persisted before
broadcast. Identical signed bytes may be retried across RPC endpoints, but a
replacement is never inferred from timeout. TX 2 confirmation requires the
exact event plus exact campaign state. TX 3 confirmation requires the exact
event plus Reward Contract inventory of at least 3.3 IRB. Failure or uncertainty
blocks the next required operation.
