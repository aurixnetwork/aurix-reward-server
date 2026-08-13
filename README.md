# Aurix Reward Server

Public backend repository for the Aurix Network reward authorization and self-claim system.

## Phase 1 status

Phase 1 provides the Node.js 22 / TypeScript / ESM foundation, deterministic
tests, structured logging, validated configuration, MySQL/MariaDB migration
foundation, and a strictly read-only BSC Testnet integration. No key or funded
wallet is required, and none of the Phase 1 commands can sign or broadcast a
transaction.

## Fixed environment

- Network: BNB Smart Chain Testnet
- Chain ID: 97
- AurixRewardClaim: `0x355D58c905f42F4f78abCD7413371F6EE4Dba137`
- Reward Test Token: IRISBANK / IRB
- IRB: `0x7daf7fE962B123A6698D5e3a109c551872790AeA`

BSC Mainnet is out of scope.

## Setup

Node.js 22 is required.

```bash
npm ci
cp .env.example .env
```

Set `BSC_TESTNET_RPC_URL` in the untracked `.env`. A secondary RPC URL is
optional. Phase 1 does not accept or require private-key settings.

## Commands

```bash
npm run build
npm run lint
npm test
npm run health:testnet
npm run preflight:testnet
npm run inspect:reward:testnet
npm run inspect:irb:testnet
```

The health check validates RPC reachability and chain identity. The preflight
additionally validates both bytecodes, the configured addresses, `rewardToken()`,
IRB metadata, pause readability, and EIP-712 domain identity. Reports identify
RPC endpoints only as `primary` or `secondary`; URLs are never emitted.

Database configuration is optional for blockchain checks. With database values
configured, `npm run db:migrate` initializes the migration ledger and applies
versioned SQL files from `database/migrations`.

## Architecture

The server verifies off-chain eligibility, creates an EIP-712 Approver authorization, and signs the final `claimReward()` transaction using the User Wallet.

The User Wallet is the transaction sender, gas payer, and reward recipient.

That write path belongs to later phases and is not implemented in Phase 1.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Configuration](docs/CONFIGURATION.md)
- [Contract integration](docs/CONTRACT_INTEGRATION.md)
- [Testnet baseline](docs/TESTNET_BASELINE.md)
- [Database foundation](docs/DATABASE_FOUNDATION.md)
- [Security model](docs/SECURITY_MODEL.md)
