import { describe, expect, it } from "vitest";

import { AURX_MAINNET_TOKEN_ADDRESS } from "../src/config/constants.js";
import {
  assertMainnetExecutionEnabled,
  loadMainnetEnvironment,
  MainnetConfigurationError,
} from "../src/config/mainnet-environment.js";

const base = { NETWORK_PROFILE: "MAINNET" };

describe("Mainnet production profile", () => {
  it("keeps the existing Testnet profile independent", async () => {
    const { loadEnvironment } = await import("../src/config/environment.js");
    expect(loadEnvironment({ BSC_TESTNET_RPC_URL: "https://test.example" }).rpc.expectedChainId).toBe(97);
  });

  it("loads fixed BSC Mainnet chain 56 and AURX", () => {
    const config = loadMainnetEnvironment(base);
    expect(config.chainId).toBe(56);
    expect(config.aurxAddress).toBe(AURX_MAINNET_TOKEN_ADDRESS);
  });

  it("rejects the wrong Mainnet chain", () => {
    expect(() => loadMainnetEnvironment({ ...base, BSC_MAINNET_CHAIN_ID: "97" })).toThrow(MainnetConfigurationError);
  });

  it("rejects Testnet IRB on Mainnet", () => {
    expect(() => loadMainnetEnvironment({
      ...base, AURX_MAINNET_TOKEN_ADDRESS: "0x7daf7fE962B123A6698D5e3a109c551872790AeA",
    })).toThrow(MainnetConfigurationError);
  });

  it("rejects any wrong Mainnet token", () => {
    expect(() => loadMainnetEnvironment({
      ...base, AURX_MAINNET_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000001",
    })).toThrow(MainnetConfigurationError);
  });

  it("represents the not-yet-deployed Reward Contract as missing", () => {
    expect(loadMainnetEnvironment(base).rewardContractAddress).toBeUndefined();
  });

  it("defaults both Mainnet execution guards to false", () => {
    expect(loadMainnetEnvironment(base).execution).toEqual({ claimEnabled: false, mainnetEnabled: false });
  });

  it("requires MAINNET_EXECUTION_ENABLED", () => {
    const config = loadMainnetEnvironment({
      ...base, CLAIM_EXECUTION_ENABLED: "true",
      MAINNET_REWARD_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
    });
    expect(() => assertMainnetExecutionEnabled(config)).toThrow("MAINNET_EXECUTION_ENABLED");
  });

  it("requires CLAIM_EXECUTION_ENABLED", () => {
    const config = loadMainnetEnvironment({
      ...base, MAINNET_EXECUTION_ENABLED: "true",
      MAINNET_REWARD_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
    });
    expect(() => assertMainnetExecutionEnabled(config)).toThrow("CLAIM_EXECUTION_ENABLED");
  });

  it("opens the execution gate only when both guards and contract are explicit", () => {
    const config = loadMainnetEnvironment({
      ...base, CLAIM_EXECUTION_ENABLED: "true", MAINNET_EXECUTION_ENABLED: "true",
      MAINNET_REWARD_CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000001",
    });
    expect(() => assertMainnetExecutionEnabled(config)).not.toThrow();
  });

  it("enforces Mainnet v1 global concurrency one", () => {
    expect(() => loadMainnetEnvironment({ ...base, GLOBAL_REWARD_CONCURRENCY: "2" })).toThrow("must equal 1");
    expect(loadMainnetEnvironment(base).dispatcher.concurrency).toBe(1);
  });

  it("uses finite explicit safety defaults", () => {
    const limits = loadMainnetEnvironment(base).limits;
    expect(limits.maxWalletsPerRun).toBe(100);
    expect(limits.maxTransactionsPerRun).toBe(100);
    expect(limits.maxRewardPerWallet).toBeGreaterThan(0n);
    expect(limits.maxAggregateRewardPerRun).toBeGreaterThan(0n);
  });
});
