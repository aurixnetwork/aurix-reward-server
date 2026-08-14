# Architecture

## Phase 1 read-only boundary

Phase 1 is a read-only integration layer. The command path is:

```text
validated environment
        |
primary/secondary RPC provider pool
        |
chain 97 selection
        |
read-only Reward Contract and IRB clients
        |
structured, sanitized inspection result
```

There is no transaction builder, raw transaction, broadcaster, campaign
mutation, funding operation, or scheduler in this phase.

## Phase 2 wallet path

```text
validated environment + database connectivity
        |
ethers test User Wallet generation
        |
AES-256-GCM encryption with address/version AAD
        |
atomic encrypted database insert and reload
        |
authenticated decryption + derived-address verification
        |
public-only CLI result
```

Phase 2's Wallet object exists only in controlled generation/decryption scope.
No provider or signer is attached and no blockchain transaction is possible
through the wallet commands.

## Modules

- `src/config` fixes the network and addresses and validates environment input.
- `src/blockchain` creates timeout-bounded RPC providers, checks each configured
  endpoint, selects primary before secondary, and validates preflight snapshots.
- `src/contracts` wraps provider-only contract reads. The Reward Contract wrapper
  uses the canonical consumer ABI; the IRB wrapper exposes ERC-20 read methods.
- `src/logging` emits JSON logs and redacts credential-shaped fields.
- `src/database` provides a lazy mysql2 pool and checksum-pinned migration runner.
- `src/wallets` owns generation, authenticated encryption, database persistence,
  public projections, batch coordination, and validation.
- `src/cli` owns explicit operational commands and always destroys RPC providers
  or closes database pools.

## Future transaction model

Later phases will read DB eligibility and on-chain campaign state, read the
claimant's contract `rewardNonce`, create and Approver-sign an EIP-712
authorization, and have the User Wallet sign and send `claimReward`. The User
Wallet—not the server or Approver—is the sender, gas payer, and recipient. Those
capabilities remain deliberately absent from Phase 1.
