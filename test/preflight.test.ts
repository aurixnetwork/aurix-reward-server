import { describe, expect, it } from "vitest";

import {
  createPreflightReport,
  PreflightValidationError,
  validateTestnetSnapshot,
  type TestnetSnapshot,
} from "../src/blockchain/preflight.js";
import {
  AURIX_REWARD_CONTRACT_ADDRESS,
  IRB_TEST_TOKEN_ADDRESS,
} from "../src/config/constants.js";
import { loadEnvironment } from "../src/config/environment.js";

const config = loadEnvironment({
  BSC_TESTNET_RPC_URL: "https://rpc.example.test",
});

const validSnapshot: TestnetSnapshot = {
  chainId: 97,
  irbCodeSizeBytes: 5_109,
  irbToken: {
    decimals: 18,
    name: "IRISBANK",
    symbol: "IRB",
    totalSupplyBaseUnits: "20000000000000000000000000000",
  },
  rewardCodeSizeBytes: 9_999,
  rewardContract: {
    domain: {
      chainId: 97,
      extensions: [],
      fields: "0x0f",
      name: "AurixRewardClaim",
      salt: "0x0000000000000000000000000000000000000000000000000000000000000000",
      verifyingContract: AURIX_REWARD_CONTRACT_ADDRESS,
      version: "1",
    },
    eip712Name: "AurixRewardClaim",
    eip712Version: "1",
    paused: false,
    rewardToken: IRB_TEST_TOKEN_ADDRESS,
  },
};

describe("testnet preflight validation", () => {
  it("validates every fixed baseline property", () => {
    const checks = validateTestnetSnapshot(validSnapshot, config);
    expect(checks).toHaveLength(15);
    expect(checks.every((check) => check.passed)).toBe(true);
  });

  it("produces a sanitized read-only report", () => {
    const report = createPreflightReport(
      validSnapshot,
      config,
      "primary",
      [{ blockNumber: 123, chainId: 97, healthy: true, label: "primary" }],
      "2026-08-14T00:00:00.000Z",
    );

    expect(report.status).toBe("passed");
    expect(report.transactionsSent).toBe(0);
    expect(JSON.stringify(report)).not.toContain(config.rpc.primaryUrl);
  });

  it("rejects mismatched token metadata", () => {
    const invalid: TestnetSnapshot = {
      ...validSnapshot,
      irbToken: { ...validSnapshot.irbToken, symbol: "NOT_IRB" },
    };
    expect(() => validateTestnetSnapshot(invalid, config)).toThrow(
      PreflightValidationError,
    );
  });
});
