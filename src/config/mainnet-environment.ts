import { getAddress, parseUnits, Wallet } from "ethers";
import { z } from "zod";

import {
  AURX_MAINNET_TOKEN_ADDRESS,
  BSC_MAINNET_CHAIN_ID,
  MAINNET_GLOBAL_CONCURRENCY,
} from "./constants.js";
import type { DatabaseConfig } from "./environment.js";

const optionalString = z.preprocess(
  (value) => value === "" ? undefined : value,
  z.string().min(1).optional(),
);
const optionalUrl = z.preprocess(
  (value) => value === "" ? undefined : value,
  z.url().refine((url) => ["http:", "https:"].includes(new URL(url).protocol)).optional(),
);
const optionalBoolean = z.preprocess(
  (value) => value === "" || value === undefined ? undefined : value,
  z.enum(["true", "false"]).transform((value) => value === "true").optional(),
);
const positiveInteger = z.coerce.number().int().positive().safe();
const decimal = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/);

const schema = z.object({
  NETWORK_PROFILE: z.literal("MAINNET"),
  BSC_MAINNET_CHAIN_ID: z.coerce.number().int().default(BSC_MAINNET_CHAIN_ID),
  BSC_MAINNET_RPC_URL: optionalUrl,
  BSC_MAINNET_RPC_URL_SECONDARY: optionalUrl,
  MAINNET_REWARD_CONTRACT_ADDRESS: optionalString,
  AURX_MAINNET_TOKEN_ADDRESS: z.string().default(AURX_MAINNET_TOKEN_ADDRESS),
  MAINNET_EXECUTION_ENABLED: optionalBoolean.default(false),
  CLAIM_EXECUTION_ENABLED: optionalBoolean.default(false),
  MAX_WALLETS_PER_RUN: positiveInteger.default(100),
  MAX_TRANSACTIONS_PER_RUN: positiveInteger.default(100),
  MAX_REWARD_PER_WALLET_AURX: decimal.default("1"),
  MAX_AGGREGATE_REWARD_PER_RUN_AURX: decimal.default("100"),
  WALLET_LEASE_SECONDS: positiveInteger.max(3_600).default(120),
  DISPATCHER_LEASE_SECONDS: positiveInteger.max(3_600).default(120),
  GLOBAL_REWARD_CONCURRENCY: z.coerce.number().int().default(MAINNET_GLOBAL_CONCURRENCY),
  APPROVER_PRIVATE_KEY: optionalString,
  APPROVER_ADDRESS: optionalString,
  AUTHORIZATION_VALIDITY_SECONDS: z.preprocess((value) => value === "" ? undefined : value, positiveInteger.optional()),
  WALLET_ENCRYPTION_KEY: optionalString,
  WALLET_ENCRYPTION_KEY_VERSION: positiveInteger.default(1),
  MAX_CLAIM_GAS_PRICE_GWEI: z.preprocess((value) => value === "" ? undefined : value, decimal.optional()),
  ESTIMATED_CLAIM_GAS: z.preprocess((value) => value === "" ? undefined : value, positiveInteger.optional()),
  DB_HOST: optionalString,
  DB_PORT: z.coerce.number().int().min(1).max(65_535).default(3_306),
  DB_NAME: optionalString,
  DB_USER: optionalString,
  DB_PASSWORD: z.string().optional(),
  DB_CONNECTION_LIMIT: z.coerce.number().int().min(1).max(100).default(10),
}).superRefine((value, context) => {
  if (value.BSC_MAINNET_CHAIN_ID !== BSC_MAINNET_CHAIN_ID) {
    context.addIssue({ code: "custom", path: ["BSC_MAINNET_CHAIN_ID"], message: "must equal 56" });
  }
  if (value.GLOBAL_REWARD_CONCURRENCY !== MAINNET_GLOBAL_CONCURRENCY) {
    context.addIssue({ code: "custom", path: ["GLOBAL_REWARD_CONCURRENCY"], message: "Mainnet v1 must equal 1" });
  }
  try {
    if (getAddress(value.AURX_MAINNET_TOKEN_ADDRESS) !== getAddress(AURX_MAINNET_TOKEN_ADDRESS)) {
      context.addIssue({ code: "custom", path: ["AURX_MAINNET_TOKEN_ADDRESS"], message: "must equal the fixed Mainnet AURX address" });
    }
  } catch {
    context.addIssue({ code: "custom", path: ["AURX_MAINNET_TOKEN_ADDRESS"], message: "must be a valid EVM address" });
  }
  if (value.MAINNET_REWARD_CONTRACT_ADDRESS) {
    try {
      getAddress(value.MAINNET_REWARD_CONTRACT_ADDRESS);
    } catch {
      context.addIssue({ code: "custom", path: ["MAINNET_REWARD_CONTRACT_ADDRESS"], message: "must be a valid deployed EVM address" });
    }
  }
  if (value.APPROVER_PRIVATE_KEY) {
    try {
      const derived = new Wallet(value.APPROVER_PRIVATE_KEY).address;
      if (value.APPROVER_ADDRESS && derived !== getAddress(value.APPROVER_ADDRESS)) {
        context.addIssue({ code: "custom", path: ["APPROVER_ADDRESS"], message: "does not match APPROVER_PRIVATE_KEY" });
      }
    } catch {
      context.addIssue({ code: "custom", path: ["APPROVER_PRIVATE_KEY"], message: "must be a valid EVM private key" });
    }
  }
  if (value.APPROVER_ADDRESS) {
    try { getAddress(value.APPROVER_ADDRESS); } catch {
      context.addIssue({ code: "custom", path: ["APPROVER_ADDRESS"], message: "must be a valid EVM address" });
    }
  }
  if (value.WALLET_ENCRYPTION_KEY) {
    const decoded = Buffer.from(value.WALLET_ENCRYPTION_KEY, "base64");
    if (decoded.length !== 32 || decoded.toString("base64") !== value.WALLET_ENCRYPTION_KEY) {
      context.addIssue({ code: "custom", path: ["WALLET_ENCRYPTION_KEY"], message: "must be canonical Base64 for 32 bytes" });
    }
  }
  const db = [value.DB_HOST, value.DB_NAME, value.DB_USER];
  if (db.some(Boolean) && db.some((entry) => !entry)) {
    context.addIssue({ code: "custom", path: ["DB_HOST"], message: "DB_HOST, DB_NAME, and DB_USER must be supplied together" });
  }
});

export interface MainnetProductionConfig {
  readonly profile: "MAINNET";
  readonly chainId: 56;
  readonly rpc: { readonly primaryUrl?: string; readonly secondaryUrl?: string };
  readonly aurxAddress: string;
  readonly rewardContractAddress?: string;
  readonly execution: { readonly mainnetEnabled: boolean; readonly claimEnabled: boolean };
  readonly claim: {
    readonly approverAddress?: string;
    readonly approverPrivateKey?: string;
    readonly authorizationValiditySeconds?: number;
    readonly walletEncryption?: { readonly key: Buffer; readonly version: number };
    readonly maxGasPriceWei?: bigint;
    readonly estimatedClaimGas?: bigint;
  };
  readonly limits: {
    readonly maxWalletsPerRun: number;
    readonly maxTransactionsPerRun: number;
    readonly maxRewardPerWallet: bigint;
    readonly maxAggregateRewardPerRun: bigint;
  };
  readonly dispatcher: {
    readonly concurrency: 1;
    readonly dispatcherLeaseSeconds: number;
    readonly walletLeaseSeconds: number;
  };
  readonly database?: DatabaseConfig;
}

export class MainnetConfigurationError extends Error {
  public constructor(public readonly issues: readonly string[]) {
    super(`Invalid Mainnet configuration: ${issues.join("; ")}`);
    this.name = "MainnetConfigurationError";
  }
}

export function loadMainnetEnvironment(source: NodeJS.ProcessEnv = process.env): MainnetProductionConfig {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new MainnetConfigurationError(result.error.issues.map(
      (issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`,
    ));
  }
  const value = result.data;
  const database = value.DB_HOST && value.DB_NAME && value.DB_USER ? {
    connectionLimit: value.DB_CONNECTION_LIMIT,
    database: value.DB_NAME,
    host: value.DB_HOST,
    password: value.DB_PASSWORD ?? "",
    port: value.DB_PORT,
    user: value.DB_USER,
  } : undefined;
  return {
    profile: "MAINNET",
    chainId: BSC_MAINNET_CHAIN_ID,
    rpc: {
      ...(value.BSC_MAINNET_RPC_URL ? { primaryUrl: value.BSC_MAINNET_RPC_URL } : {}),
      ...(value.BSC_MAINNET_RPC_URL_SECONDARY ? { secondaryUrl: value.BSC_MAINNET_RPC_URL_SECONDARY } : {}),
    },
    aurxAddress: getAddress(value.AURX_MAINNET_TOKEN_ADDRESS),
    ...(value.MAINNET_REWARD_CONTRACT_ADDRESS
      ? { rewardContractAddress: getAddress(value.MAINNET_REWARD_CONTRACT_ADDRESS) }
      : {}),
    execution: {
      claimEnabled: value.CLAIM_EXECUTION_ENABLED,
      mainnetEnabled: value.MAINNET_EXECUTION_ENABLED,
    },
    claim: {
      ...(value.APPROVER_ADDRESS ? { approverAddress: getAddress(value.APPROVER_ADDRESS) } : {}),
      ...(value.APPROVER_PRIVATE_KEY ? { approverPrivateKey: value.APPROVER_PRIVATE_KEY } : {}),
      ...(value.AUTHORIZATION_VALIDITY_SECONDS === undefined ? {} : { authorizationValiditySeconds: value.AUTHORIZATION_VALIDITY_SECONDS }),
      ...(value.WALLET_ENCRYPTION_KEY ? { walletEncryption: { key: Buffer.from(value.WALLET_ENCRYPTION_KEY, "base64"), version: value.WALLET_ENCRYPTION_KEY_VERSION } } : {}),
      ...(value.MAX_CLAIM_GAS_PRICE_GWEI ? { maxGasPriceWei: parseUnits(value.MAX_CLAIM_GAS_PRICE_GWEI, "gwei") } : {}),
      ...(value.ESTIMATED_CLAIM_GAS === undefined ? {} : { estimatedClaimGas: BigInt(value.ESTIMATED_CLAIM_GAS) }),
    },
    limits: {
      maxAggregateRewardPerRun: parseUnits(value.MAX_AGGREGATE_REWARD_PER_RUN_AURX, 18),
      maxRewardPerWallet: parseUnits(value.MAX_REWARD_PER_WALLET_AURX, 18),
      maxTransactionsPerRun: value.MAX_TRANSACTIONS_PER_RUN,
      maxWalletsPerRun: value.MAX_WALLETS_PER_RUN,
    },
    dispatcher: {
      concurrency: MAINNET_GLOBAL_CONCURRENCY,
      dispatcherLeaseSeconds: value.DISPATCHER_LEASE_SECONDS,
      walletLeaseSeconds: value.WALLET_LEASE_SECONDS,
    },
    ...(database ? { database } : {}),
  };
}

export function assertMainnetExecutionEnabled(config: MainnetProductionConfig): void {
  const missing = [
    !config.execution.mainnetEnabled ? "MAINNET_EXECUTION_ENABLED" : undefined,
    !config.execution.claimEnabled ? "CLAIM_EXECUTION_ENABLED" : undefined,
    !config.rewardContractAddress ? "MAINNET_REWARD_CONTRACT_ADDRESS" : undefined,
  ].filter((value): value is string => value !== undefined);
  if (missing.length > 0) {
    throw new MainnetConfigurationError(missing.map((field) => `${field}: required for Mainnet claim execution`));
  }
}

export function requireMainnetClaimRuntime(config: MainnetProductionConfig) {
  assertMainnetExecutionEnabled(config);
  const missing = [
    !config.rpc.primaryUrl ? "BSC_MAINNET_RPC_URL" : undefined,
    !config.database ? "DB_CONFIG" : undefined,
    !config.claim.approverPrivateKey ? "APPROVER_PRIVATE_KEY" : undefined,
    !config.claim.approverAddress ? "APPROVER_ADDRESS" : undefined,
    !config.claim.authorizationValiditySeconds ? "AUTHORIZATION_VALIDITY_SECONDS" : undefined,
    !config.claim.walletEncryption ? "WALLET_ENCRYPTION_KEY" : undefined,
  ].filter((value): value is string => value !== undefined);
  if (missing.length > 0) throw new MainnetConfigurationError(missing.map((field) => `${field}: required for Mainnet claim runtime`));
  return {
    approver: { address: config.claim.approverAddress as string, privateKey: config.claim.approverPrivateKey as string },
    authorizationValiditySeconds: config.claim.authorizationValiditySeconds as number,
    database: config.database as DatabaseConfig,
    primaryRpcUrl: config.rpc.primaryUrl as string,
    walletEncryption: config.claim.walletEncryption as { readonly key: Buffer; readonly version: number },
  };
}
