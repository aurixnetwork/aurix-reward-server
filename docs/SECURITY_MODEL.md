# Security model

## Phase 1 through Phase 5A guarantees

- Only BSC Testnet chain ID 97 is accepted.
- Only the fixed Reward Contract and IRB addresses are accepted.
- Contract clients have providers but no signers.
- Approver, Funding/Admin, Operations, and IRB Token Owner secrets are loaded
  only by separate explicit commands. Phase 4B-2 loads only the action-required
  signers inside the independently guarded execution path.
- Test User Wallet private keys exist only in controlled generation or
  decryption scope and are stored only as authenticated ciphertext.
- No mnemonic is stored or returned by the generator module.
- No unguarded command creates campaigns, sends IRB, or claims rewards.
  Campaign status and execution preflight are read-only. Native funding and
  Test Campaign execution use separate false-by-default owner-review guards.
- Reports expose endpoint labels rather than RPC URLs.
- Structured logging redacts private-key-, mnemonic-, seed-, wallet-ciphertext-,
  encryption-key-, password-, authorization-, and RPC URL-shaped fields.
- CI runs offline deterministic checks and needs no secrets.
- Phase 4A has no broadcaster. Approver signing is off-chain, the private key is
  environment-only, and the derived address must match the fixed expected
  Testnet Approver before signing.
- Phase 5A planning uses public wallet state only. Claim execution is disabled
  by default and decrypts only the claimant User Wallet after the guard and
  complete preflight.
- The claimant User Wallet is the only claim sender and gas payer. Funding,
  Admin, Operations, token-owner, and Approver keys cannot submit `claimReward`.
- Signed claim bytes are memory-only. Their hash is persisted before broadcast;
  timeouts require reconciliation and never trigger an automatic replacement.
- A successful receipt alone is insufficient: exact event, token deltas,
  campaign accounting, reward nonce, reward ID, and `lastClaimAt` must validate
  before confirmation and authorization consumption.

## Trust boundaries

The Solidity contract is the final authorization boundary for campaigns and
claim timing. A scheduler frequency can never grant eligibility. Later-phase
authorization must always read `rewardNonce` from the Reward Contract; a
transaction nonce is not a reward nonce.

Approver, Funding, and User Wallet key material must remain logically separated.
User Wallet keys must be encrypted at rest, and only the User Wallet may sign the
final claim transaction. Phase 5A authenticates AES-GCM fields and requires the
derived address to equal both the stored address and authorization claimant.
Plaintext material is scoped to local signing and is not persisted or logged.

The authorization create command never persists or logs the Approver key. It
persists only the public address, canonical typed-data hash, public signature,
and authorization fields. It verifies the recovered signer, deployed type hash,
and current `APPROVER_ROLE`. Reward ID and campaign/claimant/reward-nonce unique
keys provide database replay protection; the contract remains the final replay
and campaign authority.

The Phase 4A TEST ELIGIBILITY implementation is explicitly labeled and isolated
behind an interface. Production eligibility is fail-closed and intentionally
unimplemented. Wallet existence is not treated as a production business rule.

The Funding Wallet address is derived from its configured secret; an optional
public assertion cannot replace that source of truth. Funding commands reject a
collision with an ACTIVE test User Wallet. The Funding secret is never
persisted, raw signed bytes remain in memory, and the signed hash reaches the
database before broadcast. An RPC timeout is an uncertainty state, never proof
of failure and never permission to create a different transaction.

The campaign workflow reuses the fixed Admin/Funding Wallet only for the exact
missing Operations gas top-up. Operations alone signs `createCampaign`; the IRB
Token Owner alone signs inventory funding. Every key is address-asserted. The
signed hash and public payload reach the database before broadcast, while raw
signed bytes remain memory-only. A successful receipt is not confirmation
until its exact event and final state validate. Unresolved evidence blocks
rerun signing and every subsequent required step.

Signer custody is action-conditional. The execution path does not require or
load the Admin key when Operations already meets its tBNB target, the Operations
key when the exact campaign already exists, or the IRB Token Owner key when the
Reward Contract already meets its inventory target. A fully satisfied rerun
needs no transaction signer. This minimizes high-value key custody and prevents
fixed workflow roles from becoming unnecessary secret dependencies.

The Operations tBNB buffer is transaction preparation, not a maintenance
balance. Once campaign creation is satisfied, a lower Operations balance does
not authorize or plan an Admin transfer.

Claim idempotency is enforced in the database and against on-chain replay state.
An existing unresolved hash is reconciled before any new signing. A reverted
claim leaves its authorization READY but its failed job prevents automatic
reuse. `CONSUMED` is written only atomically with exact confirmed evidence.

## Operational handling

Keep `.env` outside Git, use credentialed RPC URLs only through the environment,
and rotate any credential suspected of exposure. Never paste a secret into an
issue, log, test fixture, report, documentation file, or commit.
