# BSC Testnet baseline

| Property | Fixed value |
| --- | --- |
| Network | BNB Smart Chain Testnet |
| Chain ID | `97` |
| AurixRewardClaim | `0x355D58c905f42F4f78abCD7413371F6EE4Dba137` |
| IRISBANK / IRB | `0x7daf7fE962B123A6698D5e3a109c551872790AeA` |
| IRB decimals | `18` |
| EIP-712 name | `AurixRewardClaim` |
| EIP-712 version | `1` |

Application constants and environment validation enforce these values. A
reachable endpoint for any other chain is unhealthy and cannot be selected.

Run `npm run health:testnet` for RPC health or `npm run preflight:testnet` for
the full on-chain read validation. Both commands use JSON-RPC read calls only.
BSC Mainnet and every transaction-producing activity are out of scope.
