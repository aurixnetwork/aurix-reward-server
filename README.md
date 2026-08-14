# Aurix Reward Server

Public backend repository for the Aurix Network reward authorization and self-claim system.

## Phase 2 status

Phase 1's strictly read-only BSC Testnet foundation remains intact. Phase 2 adds
server-managed test User Wallet generation, AES-256-GCM encrypted storage,
public-only listing, and authenticated wallet validation for MariaDB/MySQL.
Phase 2 creates no campaign, sends no tBNB, executes no claim, and broadcasts no
blockchain transaction.

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
optional. Wallet operations additionally require the database identity settings
and a backed-up `WALLET_ENCRYPTION_KEY`; see
[Configuration](docs/CONFIGURATION.md). Never commit `.env`.

## Commands

```bash
npm run build
npm run lint
npm test
npm run health:testnet
npm run preflight:testnet
npm run inspect:reward:testnet
npm run inspect:irb:testnet
npm run db:migrate
npm run wallets:create:test -- --count 10
npm run wallets:list:test
npm run wallets:validate:test
```

The health check validates RPC reachability and chain identity. The preflight
additionally validates both bytecodes, the configured addresses, `rewardToken()`,
IRB metadata, pause readability, and EIP-712 domain identity. Reports identify
RPC endpoints only as `primary` or `secondary`; URLs are never emitted.

Database configuration remains optional for blockchain checks. Wallet creation
is an atomic database batch and prints public addresses only. Listing uses a
public-only database projection. Validation decrypts ACTIVE records and confirms
their derived ethers addresses without exposing key material.

## Architecture

The server verifies off-chain eligibility, creates an EIP-712 Approver authorization, and signs the final `claimReward()` transaction using the User Wallet.

The User Wallet is the transaction sender, gas payer, and reward recipient.

That blockchain write path belongs to later phases and is not implemented in
Phase 2.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Configuration](docs/CONFIGURATION.md)
- [Contract integration](docs/CONTRACT_INTEGRATION.md)
- [Testnet baseline](docs/TESTNET_BASELINE.md)
- [Database foundation](docs/DATABASE_FOUNDATION.md)
- [Security model](docs/SECURITY_MODEL.md)
- [Test User Wallet security](docs/WALLET_SECURITY.md)
- [Test User Wallet operations](docs/TEST_WALLET_OPERATIONS.md)
