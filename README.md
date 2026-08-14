# Aurix Reward Server

Public backend repository for the Aurix Network reward authorization and self-claim system.

## Phase 4B-1 status

Phase 1's BSC Testnet foundation and Phase 2's encrypted ten-wallet store remain
intact, and Phase 3 funding is complete. Phase 4A adds the read-only campaign
model, exact EIP-712 RewardAuthorization implementation, explicit TEST
ELIGIBILITY abstraction, and persisted Approver signatures. It sends no
transaction; campaign creation, IRB transfer, and reward claims remain absent.
Phase 4B-1 adds an exact source-derived, read-only Test Campaign creation plan.
It validates roles, balances, deterministic campaign identity, parameter bounds,
transaction order, and gas without loading a signer or sending a transaction.

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
npm run lint:secrets
npm test
npm run health:testnet
npm run preflight:testnet
npm run inspect:reward:testnet
npm run inspect:irb:testnet
npm run db:migrate
npm run wallets:create:test -- --count 10
npm run wallets:list:test
npm run wallets:validate:test
npm run funding:plan:test
npm run funding:status:test
# Owner-reviewed operation only; disabled unless FUNDING_EXECUTION_ENABLED=true
npm run funding:execute:test
npm run campaign:inspect:test -- --campaign-id <bytes32>
npm run campaign:plan:create:test
npm run authorization:plan:test -- --wallet-id 1 --campaign-id <bytes32> --amount <IRB>
npm run authorization:create:test -- --wallet-id 1 --campaign-id <bytes32> --amount <IRB>
npm run authorization:verify:test -- --job-id <uuid>
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

The Phase 3 Funding Wallet may send only native tBNB to test User Wallets through
the explicitly guarded execution command. In Phase 4A the Approver signs only
off-chain typed data and pays no gas. A later phase will let the User Wallet send
the claim transaction; that write path remains unimplemented.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Configuration](docs/CONFIGURATION.md)
- [Contract integration](docs/CONTRACT_INTEGRATION.md)
- [Testnet baseline](docs/TESTNET_BASELINE.md)
- [Database foundation](docs/DATABASE_FOUNDATION.md)
- [Security model](docs/SECURITY_MODEL.md)
- [Test User Wallet security](docs/WALLET_SECURITY.md)
- [Test User Wallet operations](docs/TEST_WALLET_OPERATIONS.md)
- [tBNB funding operations](docs/TBNB_FUNDING.md)
- [Reward authorization](docs/REWARD_AUTHORIZATION.md)
- [Test Campaign preflight](docs/TEST_CAMPAIGN.md)
