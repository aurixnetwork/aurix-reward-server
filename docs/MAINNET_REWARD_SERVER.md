# BNB Smart Chain Mainnet Production Reward Server v1

## Scope and identity

The server preserves the validated Testnet Claim lifecycle and adds a durable
Production orchestration layer. Testnet remains chain 97 with IRB and its fixed
Reward Contract. Mainnet is chain 56 with 18-decimal AURX at
`0x24ECb00840081D56116fC6D076988411a5595fd0`. The Mainnet Reward Contract has no
default and stays unset until the frozen contract is deployed.

This repository does not deploy contracts, create an on-chain Campaign, transfer
AURX/BNB, fund Wallets, or manufacture DappBay activity.

## Existing Claim engine

Production dispatch delegates each eligible Item to the existing sequence:

Eligibility → Authorization → Approver EIP-712 signature → Claim Plan → encrypted
Wallet decrypt/verify → User Wallet signing → `SIGNED` persistence → guarded
broadcast → receipt → `RewardClaimed` validation → post-state validation →
`CONFIRMED` → Authorization `CONSUMED`.

EIP-712 construction is profile-aware: name `AurixRewardClaim`, version `1`,
chain 56, and the future deployed Reward Contract. The claimant User Wallet
signs and pays BNB gas; the off-chain Approver pays no gas.

## Nonces and leases

`rewardNonce` belongs to `(campaignId, claimant)` and is read from the contract.
`usedRewardIds` is contract-global. Ethereum transaction nonce belongs to one
Wallet address across every Campaign. Every execution therefore obtains a
durable `(chainId, walletAddress)` lease even though v1 global concurrency is
one. Leases store owner, unpredictable token, acquisition, and expiry, and can be
safely recovered after process death.

## Fail-closed profile

Mainnet requires `NETWORK_PROFILE=MAINNET`, chain 56, the exact AURX address, an
explicit Reward Contract, and code/token/domain validation. Execution requires
both `MAINNET_EXECUTION_ENABLED=true` and `CLAIM_EXECUTION_ENABLED=true`; both
default false. Wrong chain/token, missing address/code, gas or inventory failure,
or any safety-limit violation closes the path. Production v1 rejects global
concurrency other than one.

Finite limits cover Wallets per Run, transactions per Run, reward per Wallet,
and aggregate reward per Run. Committed defaults are deliberately finite and
must be reviewed for each rollout.

## Read-only commands

`npm run mainnet:readiness` performs RPC reads and schema queries only. It reports
network, AURX, Reward Contract, DB/migrations, multi-Campaign support, dispatcher,
Wallet lease, durable Runs, pause/resume, Wallet capacity, Campaign, gas,
inventory, guards, Canary, Pilot 100, `overallReady`, and
`transactionsSent: 0`.

`npm run mainnet:gas:readiness` requires an explicit `ESTIMATED_CLAIM_GAS` and
reports live price, every imported Wallet balance/deficit, and 5/10/100 totals.

`npm run mainnet:reward:plan -- --wallet-count 10 --reward-amount <AURX> [--inventory-buffer <AURX>]`
returns Campaign budget, contract inventory, buffer, maximum aggregate reward,
and maximum transactions without any write. There is no implicit `0.1 AURX`.

Current readiness is expected to be false until the Reward Contract, Initial
Campaign, imported Mainnet Wallets, gas, inventory, and owner-approved migrations
exist.

## Wallets, gas, and stop conditions

Controlled Mainnet import validates derived addresses, rejects duplicates,
encrypts keys with the existing AES-256-GCM design, and assigns
`network_profile=MAINNET`. It never converts Testnet Wallets or automatically
creates the Pilot set. Private keys, raw signed transactions, credentials, and
encryption material never enter output.

Gas readiness calculates live gas price, Claim gas, fee per Wallet, each Wallet's
BNB balance/deficit, and 5/10/100-Wallet totals without funding.

Dispatch stops on identity mismatch, missing code, paused/inactive/out-of-window
Campaign, budget exhaustion, aggregate inventory deficit, insufficient User BNB,
limit/lease conflict, stale or expired authorization needing review, used
rewardId without confirmation, inconclusive broadcast/receipt, or event/post-
state mismatch. Uncertain state is reconciled and never blindly rebroadcast.
