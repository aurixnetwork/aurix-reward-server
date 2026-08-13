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
`eip712Name()`, and `eip712Version()`. The canonical ABI contains mutation
entries, but the wrapper holds a provider only, exposes no generic Contract, and
implements no write method.

The IRB client uses a minimal ERC-20 read ABI for `name`, `symbol`, `decimals`,
`totalSupply`, and `balanceOf`.

## Preflight invariants

Preflight refuses success unless the connected chain is 97, both addresses have
bytecode, `rewardToken()` equals the fixed IRB address, token metadata is
IRISBANK/IRB/18, the pause state is readable, and the EIP-712 domain is
AurixRewardClaim/version 1/chain 97/the fixed verifying contract. RPC URLs are
not included in its result.
