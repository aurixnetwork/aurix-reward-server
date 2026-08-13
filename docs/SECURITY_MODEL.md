# Security model

## Phase 1 guarantees

- Only BSC Testnet chain ID 97 is accepted.
- Only the fixed Reward Contract and IRB addresses are accepted.
- Contract clients have providers but no signers.
- No private key, seed phrase, encrypted wallet, or funding credential is loaded.
- No command creates campaigns, funds wallets, claims rewards, or sends a
  transaction.
- Reports expose endpoint labels rather than RPC URLs.
- Structured logging redacts private-key-, mnemonic-, password-, authorization-,
  and RPC URL-shaped fields.
- CI runs offline deterministic checks and needs no secrets.

## Trust boundaries

The Solidity contract is the final authorization boundary for campaigns and
claim timing. A scheduler frequency can never grant eligibility. Later-phase
authorization must always read `rewardNonce` from the Reward Contract; a
transaction nonce is not a reward nonce.

Approver, Funding, and User Wallet key material must remain logically separated.
User Wallet keys must be encrypted at rest, and only the User Wallet may sign the
final claim transaction. These are future-phase requirements, not dormant Phase
1 code paths.

## Operational handling

Keep `.env` outside Git, use credentialed RPC URLs only through the environment,
and rotate any credential suspected of exposure. Never paste a secret into an
issue, log, test fixture, report, documentation file, or commit.
