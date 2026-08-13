# Aurix Reward Server

Public backend repository for the Aurix Network reward authorization and self-claim system.

## Current Environment

- Network: BNB Smart Chain Testnet
- Chain ID: 97
- AurixRewardClaim: `0x355D58c905f42F4f78abCD7413371F6EE4Dba137`
- Reward Test Token: IRISBANK / IRB
- IRB: `0x7daf7fE962B123A6698D5e3a109c551872790AeA`

## Architecture

The server verifies off-chain eligibility, creates an EIP-712 Approver authorization, and signs the final `claimReward()` transaction using the User Wallet.

The User Wallet is the transaction sender, gas payer, and reward recipient.

## Status

Initial project setup.
No production deployment.
No BSC Mainnet transactions.
