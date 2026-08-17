# Multi-Campaign Global Dispatcher

One Reward Contract may host several operationally independent Campaigns. The
server stores only name, policy, Run reward amount, dispatch interval, next due
time, status, and limits. Contract budget, distributed amount, maximum reward,
claim interval, active flag, start, and end remain authoritative on-chain.

Production v1 has a DB-backed singleton dispatcher lease and global concurrency
one. Each call handles at most one Wallet lifecycle and never sleeps inside a
Campaign. Due work sorts by oldest `nextDispatchAt`, stable Campaign ID, and Item
sequence. Safe completion advances only that Campaign to
`completedAt + dispatchIntervalSeconds`, allowing another due Campaign to run.

`dispatchIntervalSeconds` paces different Wallet operations. Contract
`claimInterval` authorizes repeated Claims for one `(campaignId, claimant)`.
Neither substitutes for the other.

The Wallet lease remains mandatory because Ethereum nonce is Wallet-global.
Future concurrency can only be enabled after owner review and must retain this
invariant. Mainnet v1 rejects configuration above one.

Inventory readiness reports each Campaign's remaining budget and sums active
liability as `max(budget-distributed, 0)`. It compares that sum with Reward
Contract AURX balance. Any deficit is `INVENTORY_RISK` and fails safely.

Rollout is a 5–10 Wallet Canary followed by a 100-distinct-Wallet
FIRST_REWARD_ONLY Run, using the same contract, Initial Campaign, dispatcher,
leases, and Claim engine. Amount and pacing are owner inputs. There is no
seven-day Pilot and no artificial DappBay activity.
