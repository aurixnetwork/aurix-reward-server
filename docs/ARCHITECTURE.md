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

## Phase 3 funding path

```text
validated chain 97 + dedicated Funding Wallet + ten ACTIVE public wallets
        |
on-chain balances + unresolved-job check + observed gas estimates
        |
read-only exact top-up plan and whole-batch sufficiency check
        |
explicit execution guard + pending nonce + sequential worker
        |
local sign -> persist SIGNED hash -> broadcast identical bytes
        |
receipt and balance verification -> terminal state or PENDING_REVIEW
```

The Funding Wallet sends only native tBNB. It never sends IRB and never calls the
Reward Contract. Read selection uses the existing primary/secondary pool. A
broadcast retry uses only the exact same signed bytes, retaining one hash and
nonce identity.

## Phase 4A authorization path

```text
validated chain 97 + ACTIVE public wallet + explicit TEST ELIGIBILITY
        |
live campaign, interval, budget, pause, and contract rewardNonce reads
        |
exact bigint amount + Unix-second validity + unique rewardId
        |
persist PLANNED authorization
        |
canonical EIP-712 hash + Approver signature + recovered signer/role check
        |
persist hash/signature -> READY
```

The Approver is an off-chain signer and pays no gas. Phase 4A has no transaction
broadcaster and sends zero transactions. Phase 5 will use the persisted
authorization in a User Wallet-signed `claimReward()` transaction.

## Phase 4B-1 Test Campaign preflight

```text
canonical deployed Solidity + byte-identical ABI
        |
chain 97 preflight + ten ACTIVE wallet count
        |
public campaign mapping + deployed interval constants + role reads
        |
IRB/native balances + current gas price
        |
unsigned calldata construction + eth_estimateGas
        |
RECOMMENDED_NOT_APPROVED plan with transactionsSent = 0
```

The campaign plan uses providers and ABI encoders only; it contains no signer,
database write, execution flag, or broadcast method. The deterministic proposal
is not a claim of on-chain existence. No server campaign registry is introduced
before a real creation transaction exists; the public mapping remains the source
of truth.

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
- `src/funding` owns exact Wei planning, role collision checks, funding jobs,
  sequential execution, broadcast identity, and restart reconciliation.
- `src/authorization` owns the canonical EIP-712 schema, exact IRB/base-unit and
  validity policies, reward IDs, eligibility abstraction, job repository,
  signing, and independent verification.
- `src/campaign` owns deterministic Test Campaign proposal validation, role and
  balance sufficiency checks, unsigned transaction ordering, gas estimation,
  and safe public presentation.
- `src/cli` owns explicit operational commands and always destroys RPC providers
  or closes database pools.

## Claim transaction model

Phase 4A reads on-chain campaign state and the claimant's contract
`rewardNonce`, then creates and Approver-signs an EIP-712 authorization. A later
phase will have the User Wallet sign and send `claimReward`. The User Wallet—not
the Approver—is the sender, gas payer, and recipient. The claim broadcaster is
deliberately absent from Phase 4A.
