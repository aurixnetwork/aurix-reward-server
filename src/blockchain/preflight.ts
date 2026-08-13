import { getAddress, type Provider } from "ethers";

import type { RpcEndpointLabel, RpcProbeResult } from "./rpc-provider.js";
import {
  AURIX_REWARD_CONTRACT_ADDRESS,
  BSC_TESTNET_CHAIN_ID,
  IRB_EXPECTED_DECIMALS,
  IRB_EXPECTED_NAME,
  IRB_EXPECTED_SYMBOL,
  IRB_TEST_TOKEN_ADDRESS,
  REWARD_EIP712_NAME,
  REWARD_EIP712_VERSION,
} from "../config/constants.js";
import type { AppConfig } from "../config/environment.js";
import {
  RewardContractClient,
  type RewardContractInspection,
} from "../contracts/reward-contract-client.js";
import {
  IrbTokenClient,
  type IrbTokenInspection,
} from "../contracts/irb-token-client.js";

export interface TestnetSnapshot {
  readonly chainId: number;
  readonly irbCodeSizeBytes: number;
  readonly irbToken: IrbTokenInspection;
  readonly rewardCodeSizeBytes: number;
  readonly rewardContract: RewardContractInspection;
}

export interface PreflightCheck {
  readonly name: string;
  readonly passed: boolean;
}

export interface TestnetPreflightReport {
  readonly checkedAt: string;
  readonly checks: readonly PreflightCheck[];
  readonly contracts: {
    readonly irb: IrbTokenInspection & { readonly address: string; readonly codeSizeBytes: number };
    readonly reward: RewardContractInspection & {
      readonly address: string;
      readonly codeSizeBytes: number;
    };
  };
  readonly network: {
    readonly chainId: number;
    readonly name: "BNB Smart Chain Testnet";
  };
  readonly rpc: {
    readonly endpoints: readonly RpcProbeResult[];
    readonly selectedEndpoint: RpcEndpointLabel;
  };
  readonly status: "passed";
  readonly transactionsSent: 0;
}

export class PreflightValidationError extends Error {
  public readonly failedChecks: readonly string[];

  public constructor(failedChecks: readonly string[]) {
    super(`BSC Testnet preflight failed: ${failedChecks.join(", ")}`);
    this.name = "PreflightValidationError";
    this.failedChecks = failedChecks;
  }
}

export async function collectTestnetSnapshot(
  provider: Provider,
  config: AppConfig,
): Promise<TestnetSnapshot> {
  const rewardClient = new RewardContractClient(
    provider,
    config.contracts.rewardContractAddress,
  );
  const irbClient = new IrbTokenClient(provider, config.contracts.irbTokenAddress);

  const [network, rewardCode, irbCode, rewardContract, irbToken] =
    await Promise.all([
      provider.getNetwork(),
      provider.getCode(config.contracts.rewardContractAddress),
      provider.getCode(config.contracts.irbTokenAddress),
      rewardClient.inspect(),
      irbClient.inspect(),
    ]);

  return {
    chainId: Number(network.chainId),
    irbCodeSizeBytes: bytecodeSize(irbCode),
    irbToken,
    rewardCodeSizeBytes: bytecodeSize(rewardCode),
    rewardContract,
  };
}

function bytecodeSize(code: string): number {
  return code === "0x" ? 0 : (code.length - 2) / 2;
}

export function validateTestnetSnapshot(
  snapshot: TestnetSnapshot,
  config: AppConfig,
): readonly PreflightCheck[] {
  const expectedRewardAddress = getAddress(AURIX_REWARD_CONTRACT_ADDRESS);
  const expectedIrbAddress = getAddress(IRB_TEST_TOKEN_ADDRESS);
  const domain = snapshot.rewardContract.domain;

  const checks: PreflightCheck[] = [
    { name: "chain_id", passed: snapshot.chainId === BSC_TESTNET_CHAIN_ID },
    {
      name: "configured_reward_contract_address",
      passed: config.contracts.rewardContractAddress === expectedRewardAddress,
    },
    {
      name: "configured_irb_token_address",
      passed: config.contracts.irbTokenAddress === expectedIrbAddress,
    },
    { name: "reward_contract_bytecode", passed: snapshot.rewardCodeSizeBytes > 0 },
    { name: "irb_token_bytecode", passed: snapshot.irbCodeSizeBytes > 0 },
    {
      name: "reward_token",
      passed: snapshot.rewardContract.rewardToken === expectedIrbAddress,
    },
    { name: "reward_paused_state_readable", passed: typeof snapshot.rewardContract.paused === "boolean" },
    { name: "irb_name", passed: snapshot.irbToken.name === IRB_EXPECTED_NAME },
    { name: "irb_symbol", passed: snapshot.irbToken.symbol === IRB_EXPECTED_SYMBOL },
    { name: "irb_decimals", passed: snapshot.irbToken.decimals === IRB_EXPECTED_DECIMALS },
    { name: "eip712_name", passed: domain.name === REWARD_EIP712_NAME },
    { name: "eip712_version", passed: domain.version === REWARD_EIP712_VERSION },
    { name: "eip712_chain_id", passed: domain.chainId === BSC_TESTNET_CHAIN_ID },
    {
      name: "eip712_verifying_contract",
      passed: domain.verifyingContract === expectedRewardAddress,
    },
    {
      name: "eip712_identity_getters",
      passed:
        snapshot.rewardContract.eip712Name === domain.name &&
        snapshot.rewardContract.eip712Version === domain.version,
    },
  ];

  const failedChecks = checks.filter((check) => !check.passed).map((check) => check.name);
  if (failedChecks.length > 0) {
    throw new PreflightValidationError(failedChecks);
  }

  return checks;
}

export function createPreflightReport(
  snapshot: TestnetSnapshot,
  config: AppConfig,
  selectedEndpoint: RpcEndpointLabel,
  probes: readonly RpcProbeResult[],
  checkedAt: string = new Date().toISOString(),
): TestnetPreflightReport {
  const checks = validateTestnetSnapshot(snapshot, config);
  return {
    checkedAt,
    checks,
    contracts: {
      irb: {
        address: config.contracts.irbTokenAddress,
        codeSizeBytes: snapshot.irbCodeSizeBytes,
        ...snapshot.irbToken,
      },
      reward: {
        address: config.contracts.rewardContractAddress,
        codeSizeBytes: snapshot.rewardCodeSizeBytes,
        ...snapshot.rewardContract,
      },
    },
    network: {
      chainId: snapshot.chainId,
      name: "BNB Smart Chain Testnet",
    },
    rpc: {
      endpoints: probes,
      selectedEndpoint,
    },
    status: "passed",
    transactionsSent: 0,
  };
}
