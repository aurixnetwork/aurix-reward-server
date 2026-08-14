# Security Policy

Never publish:

- private keys
- seed phrases
- wallet encryption keys
- RPC credentials
- database credentials
- funding wallet secrets
- Approver secrets
- User Wallet secrets

Security findings should be reported privately before public disclosure.

## Phase 1 through Phase 4A controls

- Phase 1 loads no wallet, funding, or Approver private keys.
- Blockchain clients are constructed with providers only; no signer is present.
- RPC URLs and database passwords are redacted by the structured logger and are
  not included in health or preflight reports.
- Environment validation rejects any chain ID other than BSC Testnet `97` and
  rejects contract addresses outside the fixed testnet baseline.
- `.env`, key, wallet, secret, export, and backup paths are ignored by Git.
- CI requires no network credentials and performs no live blockchain actions.
- Test User Wallet private keys are encrypted before database persistence with
  AES-256-GCM, a random 12-byte IV, and address/version-bound authenticated data.
- No mnemonic is stored. Public listing queries do not select encrypted fields.
- Decryption validates GCM authentication and independently derives and compares
  the expected EVM address.
- Admin/Deployer, Approver, Operations, Funding, and test User Wallet roles must
  remain separate.
- The Funding Wallet address is derived from its private key and an optional
  expected address must match. Execution rejects a collision with an ACTIVE
  test User Wallet.
- Funding execution is disabled unless `FUNDING_EXECUTION_ENABLED=true`; the
  plan command is read-only and reports zero transactions.
- Raw signed transactions are kept only in memory. The signed hash is persisted
  before broadcast, and timeouts remain unresolved for reconciliation.
- Funding logs redact Funding keys, raw/signed transactions, wallet ciphertext,
  private keys, mnemonics, and database/RPC credentials.
- The Approver key remains in the ignored environment only. The public address
  is derived from it and must match the fixed expected Testnet assertion before
  signing; the current on-chain `APPROVER_ROLE` is checked read-only.
- Phase 4A persists only authorization fields, typed-data hashes, and public
  signatures. It has no transaction broadcaster and sends no blockchain
  transaction.
- The canonical EIP-712 type and deployed type hash, recovered signer, unique
  reward ID, and campaign/claimant/contract-nonce tuple are verified before an
  authorization is ready.

Back up `WALLET_ENCRYPTION_KEY` and its version in an approved secret manager.
If this key is lost, encrypted User Wallet private keys may be permanently
unrecoverable. If it is exposed, report the incident privately and treat wallets
using that key version as compromised.

Before reporting a suspected secret, avoid placing the value in an issue, log,
or terminal transcript. Report only its type and location through a private
channel.
