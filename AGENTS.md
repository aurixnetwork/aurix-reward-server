# Aurix Reward Server — Codex Instructions

## Project

Aurix Network Reward Server

Repository purpose:
Public Node.js/TypeScript backend for the Aurix Network reward authorization and claim execution system.

This repository is separate from:

aurixnetwork/aurix-reward-contract

## Fixed BSC Testnet baseline

Network:
BNB Smart Chain Testnet

Chain ID:
97

AurixRewardClaim:
0x355D58c905f42F4f78abCD7413371F6EE4Dba137

IRISBANK / IRB:
0x7daf7fE962B123A6698D5e3a109c551872790AeA

Reward Contract ABI source:
aurix-reward-contract/abi/AurixRewardClaim.json

## Architecture

The backend:

1. Checks DB reward eligibility.
2. Reads the current campaign state from the Reward Contract.
3. Reads the claimant rewardNonce.
4. Creates RewardAuthorization.
5. Signs EIP-712 authorization with the Approver private key.
6. Builds claimReward calldata.
7. Signs the final transaction with the User Wallet private key.
8. Broadcasts the raw transaction to BSC Testnet.
9. Confirms the receipt.
10. Confirms RewardClaimed event values.
11. Confirms IRB token balance changes.
12. Persists all execution results.

## Gas model

Approver:
- Off-chain EIP-712 signature
- Pays no gas

User Wallet:
- Signs the final claimReward transaction
- Pays tBNB gas
- transaction.from = User Wallet
- msg.sender = User Wallet
- reward recipient = User Wallet

The server or Approver wallet must not send the final claim transaction.

## Campaign timing

The Solidity contract is the final source of truth.

Campaign claim interval:
- Minimum 1 hour
- Maximum 7 days
- Configurable per campaign

Server scheduler interval is separate.

Example:

Scheduler checks every 60 seconds.
Campaign may allow one claim every 1 hour, 1 day, or 7 days.

Never treat scheduler timing as an authorization boundary.

## Technology

- Node.js 22
- TypeScript
- ESM
- ethers.js v6
- MariaDB/MySQL
- mysql2
- structured logging
- deterministic tests
- PM2 for AWS operation

## Wallet policy

Initial Testnet scope:
10 User Wallets.

User Wallet private keys must be encrypted at rest.

Never:
- commit private keys
- log private keys
- log mnemonic phrases
- put secrets in README
- expose .env
- store plaintext wallet secrets in Git

Approver key, Funding key, and User Wallet keys must remain logically separated.

## Funding

The server must check each User Wallet tBNB balance.

Only top up the missing amount required to reach the configured target balance.

Do not blindly send tBNB repeatedly.

Persist:
- funding job ID
- wallet
- balance before
- amount sent
- tx hash
- receipt
- gas
- balance after
- status

## Reward IDs

Every reward execution must use a unique rewardId.

The server must never intentionally issue the same rewardId twice.

Do not use transaction nonce as rewardNonce.

rewardNonce must always be read from the Reward Contract.

## Transaction safety

Before signing:

- validate chain ID 97
- validate Reward Contract bytecode
- validate IRB bytecode
- validate contract rewardToken
- validate claimant
- read rewardNonce
- verify DB eligibility
- check campaign state
- check User Wallet tBNB balance
- estimate gas
- obtain pending transaction nonce

Before broadcast persist:

- deterministic job ID
- campaignId
- rewardId
- claimant
- rewardNonce
- authorization
- authorization hash
- Approver signature
- signed transaction hash

Do not persist plaintext private keys.

After broadcast persist:

- all transaction hashes
- receipt status
- block number
- gas used
- effective gas price
- total fee
- RewardClaimed event
- token balance before and after

Never mark a reward confirmed without:
- successful receipt
- matching RewardClaimed event

## Reliability

Support:
- process restart recovery
- pending transaction tracking
- failed transaction retry policy
- idempotent job processing
- duplicate prevention
- RPC failover
- nonce conflict handling

Do not retry a confirmed reward.

## Development phases

Phase 1:
Project foundation and blockchain read-only connection.

Phase 2:
10 Test User Wallets and encrypted storage.

Phase 3:
tBNB funding.

Phase 4:
Approver authorization.

Phase 5:
User Wallet claim execution.

Phase 6:
Scheduler and recovery.

Phase 7:
10-Wallet end-to-end Testnet validation.

Phase 8:
AWS deployment.

## Git

Public repository.

Use small reviewable commits.

Never commit secrets.

Never rewrite or force-push public main history without explicit owner approval.

Do not perform BSC Mainnet transactions.

Do not deploy production services unless explicitly approved.
