# Security model

## Phase 1 through Phase 3 guarantees

- Only BSC Testnet chain ID 97 is accepted.
- Only the fixed Reward Contract and IRB addresses are accepted.
- Contract clients have providers but no signers.
- No Approver, Funding, Admin, or Operations credential is loaded.
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

## Trust boundaries

The Solidity contract is the final authorization boundary for campaigns and
claim timing. A scheduler frequency can never grant eligibility. Later-phase
authorization must always read `rewardNonce` from the Reward Contract; a
transaction nonce is not a reward nonce.

Approver, Funding, and User Wallet key material must remain logically separated.
User Wallet keys must be encrypted at rest, and only the User Wallet may sign the
final claim transaction. The claim-signing path remains a future phase; Phase 3
loads only the separate Funding Wallet signer in its guarded execution command.

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
