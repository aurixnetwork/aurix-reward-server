# Security model

## Phase 1 through Phase 4A guarantees

- Only BSC Testnet chain ID 97 is accepted.
- Only the fixed Reward Contract and IRB addresses are accepted.
- Contract clients have providers but no signers.
- Approver and Funding secrets are loaded only by their separate, explicit
  commands; Admin and Operations credentials are not loaded.
- Test User Wallet private keys exist only in controlled generation or
  decryption scope and are stored only as authenticated ciphertext.
- No mnemonic is stored or returned by the generator module.
- No command creates campaigns, sends IRB, or claims rewards. The funding plan
  is read-only. Native tBNB execution exists only behind an explicit false-by-
  default owner-review guard.
- Reports expose endpoint labels rather than RPC URLs.
- Structured logging redacts private-key-, mnemonic-, seed-, wallet-ciphertext-,
  encryption-key-, password-, authorization-, and RPC URL-shaped fields.
- CI runs offline deterministic checks and needs no secrets.
- Phase 4A has no broadcaster. Approver signing is off-chain, the private key is
  environment-only, and the derived address must match the fixed expected
  Testnet Approver before signing.

## Trust boundaries

The Solidity contract is the final authorization boundary for campaigns and
claim timing. A scheduler frequency can never grant eligibility. Later-phase
authorization must always read `rewardNonce` from the Reward Contract; a
transaction nonce is not a reward nonce.

Approver, Funding, and User Wallet key material must remain logically separated.
User Wallet keys must be encrypted at rest, and only the User Wallet may sign the
final claim transaction. The claim-signing path remains a future phase; Phase 3
loads only the separate Funding Wallet signer in its guarded execution command.

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

## Operational handling

Keep `.env` outside Git, use credentialed RPC URLs only through the environment,
and rotate any credential suspected of exposure. Never paste a secret into an
issue, log, test fixture, report, documentation file, or commit.
