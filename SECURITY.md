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

## Phase 1 controls

- Phase 1 loads no wallet, funding, or Approver private keys.
- Blockchain clients are constructed with providers only; no signer is present.
- RPC URLs and database passwords are redacted by the structured logger and are
  not included in health or preflight reports.
- Environment validation rejects any chain ID other than BSC Testnet `97` and
  rejects contract addresses outside the fixed testnet baseline.
- `.env`, key, wallet, secret, export, and backup paths are ignored by Git.
- CI requires no network credentials and performs no live blockchain actions.

Before reporting a suspected secret, avoid placing the value in an issue, log,
or terminal transcript. Report only its type and location through a private
channel.
