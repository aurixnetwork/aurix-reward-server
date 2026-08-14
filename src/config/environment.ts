import { getAddress, parseEther, parseUnits, Wallet } from "ethers";
import { z } from "zod";

import {
  AURIX_REWARD_CONTRACT_ADDRESS,
  BSC_TESTNET_CHAIN_ID,
  DEFAULT_WALLET_ENCRYPTION_KEY_VERSION,
  IRB_TEST_TOKEN_ADDRESS,
  TESTNET_APPROVER_ADDRESS,
} from "./constants.js";

const optionalNonEmptyString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

const httpUrl = z.url().refine(
  (value) => ["http:", "https:"].includes(new URL(value).protocol),
  "must use the http or https protocol",
);

const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  httpUrl.optional(),
);

const optionalBoolean = z.preprocess(
  (value) => (value === "" || value === undefined ? undefined : value),
  z.enum(["true", "false"]).transform((value) => value === "true").optional(),
);

const optionalPositiveSafeInteger = z.preprocess(
  (value) => (value === "" || value === undefined ? undefined : value),
  z.coerce.number().int().positive().safe().optional(),
);

const DECIMAL_AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/;

export function parsePositiveEtherAmount(value: string, field: string): bigint {
  if (!DECIMAL_AMOUNT_PATTERN.test(value)) {
    throw new ConfigurationError([
      `${field}: must be a positive decimal with at most 18 fractional digits`,
    ]);
  }
  const amount = parseEther(value);
  if (amount <= 0n) {
    throw new ConfigurationError([`${field}: must be greater than zero`]);
  }
  return amount;
}

function parsePositiveGweiAmount(value: string, field: string): bigint {
  if (!DECIMAL_AMOUNT_PATTERN.test(value)) {
    throw new ConfigurationError([
      `${field}: must be a positive decimal with at most 18 fractional digits`,
    ]);
  }
  const amount = parseUnits(value, "gwei");
  if (amount <= 0n) {
    throw new ConfigurationError([`${field}: must be greater than zero`]);
  }
  return amount;
}

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function decodeWalletEncryptionKey(value: string): Buffer | undefined {
  if (!BASE64_PATTERN.test(value)) {
    return undefined;
  }

  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value || decoded.length !== 32) {
    return undefined;
  }
  return decoded;
}

const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    BSC_TESTNET_RPC_URL: httpUrl,
    BSC_TESTNET_RPC_URL_SECONDARY: optionalUrl,
    BSC_TESTNET_CHAIN_ID: z.coerce.number().int().default(BSC_TESTNET_CHAIN_ID),
    RPC_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(10_000),
    AURIX_REWARD_CONTRACT_ADDRESS: z
      .string()
      .default(AURIX_REWARD_CONTRACT_ADDRESS),
    IRB_TEST_TOKEN_ADDRESS: z.string().default(IRB_TEST_TOKEN_ADDRESS),
    DB_HOST: optionalNonEmptyString,
    DB_PORT: z.coerce.number().int().min(1).max(65_535).default(3_306),
    DB_NAME: optionalNonEmptyString,
    DB_USER: optionalNonEmptyString,
    DB_PASSWORD: z.string().optional(),
    DB_CONNECTION_LIMIT: z.coerce.number().int().min(1).max(100).default(10),
    WALLET_ENCRYPTION_KEY: optionalNonEmptyString,
    WALLET_ENCRYPTION_KEY_VERSION: z.coerce
      .number()
      .int()
      .min(1)
      .default(DEFAULT_WALLET_ENCRYPTION_KEY_VERSION),
    TESTNET_FUNDING_PRIVATE_KEY: optionalNonEmptyString,
    TESTNET_FUNDING_ADDRESS: optionalNonEmptyString,
    TEST_WALLET_TARGET_TBNB: optionalNonEmptyString,
    MAX_FUNDING_GAS_PRICE_GWEI: optionalNonEmptyString,
    FUNDING_EXECUTION_ENABLED: optionalBoolean.default(false),
    APPROVER_PRIVATE_KEY: optionalNonEmptyString,
    APPROVER_ADDRESS: optionalNonEmptyString,
    AUTHORIZATION_VALIDITY_SECONDS: optionalPositiveSafeInteger,
  })
  .superRefine((value, context) => {
    if (value.BSC_TESTNET_CHAIN_ID !== BSC_TESTNET_CHAIN_ID) {
      context.addIssue({
        code: "custom",
        message: `must equal the fixed BSC Testnet chain ID ${BSC_TESTNET_CHAIN_ID}`,
        path: ["BSC_TESTNET_CHAIN_ID"],
      });
    }

    validateBaselineAddress(
      value.AURIX_REWARD_CONTRACT_ADDRESS,
      AURIX_REWARD_CONTRACT_ADDRESS,
      "AURIX_REWARD_CONTRACT_ADDRESS",
      context,
    );
    validateBaselineAddress(
      value.IRB_TEST_TOKEN_ADDRESS,
      IRB_TEST_TOKEN_ADDRESS,
      "IRB_TEST_TOKEN_ADDRESS",
      context,
    );

    const databaseValues = [value.DB_HOST, value.DB_NAME, value.DB_USER];
    if (databaseValues.some(Boolean) && databaseValues.some((entry) => !entry)) {
      context.addIssue({
        code: "custom",
        message: "DB_HOST, DB_NAME, and DB_USER must be supplied together",
        path: ["DB_HOST"],
      });
    }
    if (
      value.WALLET_ENCRYPTION_KEY &&
      !decodeWalletEncryptionKey(value.WALLET_ENCRYPTION_KEY)
    ) {
      context.addIssue({
        code: "custom",
        message: "must be canonical Base64 encoding of exactly 32 bytes",
        path: ["WALLET_ENCRYPTION_KEY"],
      });
    }
    if (value.TESTNET_FUNDING_PRIVATE_KEY) {
      try {
        void new Wallet(value.TESTNET_FUNDING_PRIVATE_KEY);
      } catch {
        context.addIssue({
          code: "custom",
          message: "must be a valid 32-byte EVM private key",
          path: ["TESTNET_FUNDING_PRIVATE_KEY"],
        });
      }
    }
    if (value.TESTNET_FUNDING_ADDRESS) {
      try {
        getAddress(value.TESTNET_FUNDING_ADDRESS);
      } catch {
        context.addIssue({
          code: "custom",
          message: "must be a valid EVM address",
          path: ["TESTNET_FUNDING_ADDRESS"],
        });
      }
    }
    if (value.APPROVER_PRIVATE_KEY) {
      try {
        void new Wallet(value.APPROVER_PRIVATE_KEY);
      } catch {
        context.addIssue({
          code: "custom",
          message: "must be a valid 32-byte EVM private key",
          path: ["APPROVER_PRIVATE_KEY"],
        });
      }
    }
    if (value.APPROVER_ADDRESS) {
      validateBaselineAddress(
        value.APPROVER_ADDRESS,
        TESTNET_APPROVER_ADDRESS,
        "APPROVER_ADDRESS",
        context,
      );
    }
    for (const [field, amount] of [
      ["TEST_WALLET_TARGET_TBNB", value.TEST_WALLET_TARGET_TBNB],
      ["MAX_FUNDING_GAS_PRICE_GWEI", value.MAX_FUNDING_GAS_PRICE_GWEI],
    ] as const) {
      if (amount) {
        try {
          if (field === "TEST_WALLET_TARGET_TBNB") {
            parsePositiveEtherAmount(amount, field);
          } else {
            parsePositiveGweiAmount(amount, field);
          }
        } catch (error: unknown) {
          const issue = error instanceof ConfigurationError ? error.issues[0] : undefined;
          context.addIssue({
            code: "custom",
            message: issue?.split(": ").slice(1).join(": ") ?? "is invalid",
            path: [field],
          });
        }
      }
    }
  });

function validateBaselineAddress(
  actual: string,
  expected: string,
  path: string,
  context: z.core.$RefinementCtx<Record<string, unknown>>,
): void {
  try {
    if (getAddress(actual) !== getAddress(expected)) {
      context.addIssue({
        code: "custom",
        message: `must equal the fixed BSC Testnet address ${expected}`,
        path: [path],
      });
    }
  } catch {
    context.addIssue({
      code: "custom",
      message: "must be a valid EVM address",
      path: [path],
    });
  }
}

export interface DatabaseConfig {
  readonly connectionLimit: number;
  readonly database: string;
  readonly host: string;
  readonly password: string;
  readonly port: number;
  readonly user: string;
}

export interface AppConfig {
  readonly contracts: {
    readonly irbTokenAddress: string;
    readonly rewardContractAddress: string;
  };
  readonly database: DatabaseConfig | undefined;
  readonly logLevel: string;
  readonly nodeEnv: "development" | "test" | "production";
  readonly rpc: {
    readonly expectedChainId: number;
    readonly primaryUrl: string;
    readonly secondaryUrl: string | undefined;
    readonly timeoutMs: number;
  };
  readonly walletEncryption: WalletEncryptionConfig | undefined;
  readonly funding: FundingEnvironmentConfig;
  readonly authorization: AuthorizationEnvironmentConfig;
}

export interface AuthorizationEnvironmentConfig {
  readonly approverExpectedAddress: string;
  readonly approverPrivateKey: string | undefined;
  readonly validitySeconds: number | undefined;
}

export interface AuthorizationPolicyConfig {
  readonly validitySeconds: number;
}

export interface ApproverConfig {
  readonly address: string;
  readonly privateKey: string;
}

export interface FundingEnvironmentConfig {
  readonly executionEnabled: boolean;
  readonly expectedAddress: string | undefined;
  readonly maxGasPriceWei: bigint | undefined;
  readonly privateKey: string | undefined;
  readonly targetBalanceWei: bigint | undefined;
}

export interface FundingConfig {
  readonly address: string;
  readonly executionEnabled: boolean;
  readonly maxGasPriceWei: bigint | undefined;
  readonly privateKey: string;
  readonly targetBalanceWei: bigint;
}

export interface WalletEncryptionConfig {
  readonly key: Buffer;
  readonly version: number;
}

export class ConfigurationError extends Error {
  public readonly issues: readonly string[];

  public constructor(issues: readonly string[]) {
    super(`Invalid environment configuration: ${issues.join("; ")}`);
    this.name = "ConfigurationError";
    this.issues = issues;
  }
}

export function loadEnvironment(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = environmentSchema.safeParse(source);
  if (!result.success) {
    throw new ConfigurationError(
      result.error.issues.map(
        (issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`,
      ),
    );
  }

  const value = result.data;
  const database =
    value.DB_HOST && value.DB_NAME && value.DB_USER
      ? {
          connectionLimit: value.DB_CONNECTION_LIMIT,
          database: value.DB_NAME,
          host: value.DB_HOST,
          password: value.DB_PASSWORD ?? "",
          port: value.DB_PORT,
          user: value.DB_USER,
        }
      : undefined;
  const encryptionKey = value.WALLET_ENCRYPTION_KEY
    ? decodeWalletEncryptionKey(value.WALLET_ENCRYPTION_KEY)
    : undefined;

  return {
    contracts: {
      irbTokenAddress: getAddress(value.IRB_TEST_TOKEN_ADDRESS),
      rewardContractAddress: getAddress(value.AURIX_REWARD_CONTRACT_ADDRESS),
    },
    database,
    logLevel: value.LOG_LEVEL,
    nodeEnv: value.NODE_ENV,
    rpc: {
      expectedChainId: value.BSC_TESTNET_CHAIN_ID,
      primaryUrl: value.BSC_TESTNET_RPC_URL,
      secondaryUrl: value.BSC_TESTNET_RPC_URL_SECONDARY,
      timeoutMs: value.RPC_TIMEOUT_MS,
    },
    walletEncryption: encryptionKey
      ? { key: encryptionKey, version: value.WALLET_ENCRYPTION_KEY_VERSION }
      : undefined,
    funding: {
      executionEnabled: value.FUNDING_EXECUTION_ENABLED,
      expectedAddress: value.TESTNET_FUNDING_ADDRESS
        ? getAddress(value.TESTNET_FUNDING_ADDRESS)
        : undefined,
      maxGasPriceWei: value.MAX_FUNDING_GAS_PRICE_GWEI
        ? parsePositiveGweiAmount(
            value.MAX_FUNDING_GAS_PRICE_GWEI,
            "MAX_FUNDING_GAS_PRICE_GWEI",
          )
        : undefined,
      privateKey: value.TESTNET_FUNDING_PRIVATE_KEY,
      targetBalanceWei: value.TEST_WALLET_TARGET_TBNB
        ? parsePositiveEtherAmount(
            value.TEST_WALLET_TARGET_TBNB,
            "TEST_WALLET_TARGET_TBNB",
          )
        : undefined,
    },
    authorization: {
      approverExpectedAddress: value.APPROVER_ADDRESS
        ? getAddress(value.APPROVER_ADDRESS)
        : getAddress(TESTNET_APPROVER_ADDRESS),
      approverPrivateKey: value.APPROVER_PRIVATE_KEY,
      validitySeconds: value.AUTHORIZATION_VALIDITY_SECONDS,
    },
  };
}

export function requireWalletEncryptionConfig(
  config: AppConfig,
): WalletEncryptionConfig {
  if (!config.walletEncryption) {
    throw new ConfigurationError([
      "WALLET_ENCRYPTION_KEY: required for test wallet operations and must be canonical Base64 encoding of exactly 32 bytes",
    ]);
  }
  return config.walletEncryption;
}

export function requireFundingConfig(config: AppConfig): FundingConfig {
  const issues: string[] = [];
  if (!config.funding.privateKey) {
    issues.push("TESTNET_FUNDING_PRIVATE_KEY: required for funding commands");
  }
  if (config.funding.targetBalanceWei === undefined) {
    issues.push("TEST_WALLET_TARGET_TBNB: explicit positive target is required");
  }
  if (issues.length > 0) {
    throw new ConfigurationError(issues);
  }

  const privateKey = config.funding.privateKey as string;
  const address = new Wallet(privateKey).address;
  if (
    config.funding.expectedAddress &&
    address !== config.funding.expectedAddress
  ) {
    throw new ConfigurationError([
      "TESTNET_FUNDING_ADDRESS: does not match the address derived from TESTNET_FUNDING_PRIVATE_KEY",
    ]);
  }

  return {
    address,
    executionEnabled: config.funding.executionEnabled,
    maxGasPriceWei: config.funding.maxGasPriceWei,
    privateKey,
    targetBalanceWei: config.funding.targetBalanceWei as bigint,
  };
}

export function requireAuthorizationPolicy(
  config: AppConfig,
): AuthorizationPolicyConfig {
  if (config.authorization.validitySeconds === undefined) {
    throw new ConfigurationError([
      "AUTHORIZATION_VALIDITY_SECONDS: explicit positive Unix-second validity is required",
    ]);
  }
  return { validitySeconds: config.authorization.validitySeconds };
}

export function requireApproverConfig(config: AppConfig): ApproverConfig {
  if (!config.authorization.approverPrivateKey) {
    throw new ConfigurationError([
      "APPROVER_PRIVATE_KEY: required for authorization signing",
    ]);
  }
  const privateKey = config.authorization.approverPrivateKey;
  const derivedAddress = new Wallet(privateKey).address;
  if (derivedAddress !== config.authorization.approverExpectedAddress) {
    throw new ConfigurationError([
      "APPROVER_ADDRESS: configured/fixed expected address does not match APPROVER_PRIVATE_KEY",
    ]);
  }
  return { address: derivedAddress, privateKey };
}
