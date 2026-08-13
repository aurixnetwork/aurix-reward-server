import { describe, expect, it } from "vitest";

import {
  AURIX_REWARD_CONTRACT_ADDRESS,
  BSC_TESTNET_CHAIN_ID,
  IRB_TEST_TOKEN_ADDRESS,
} from "../src/config/constants.js";
import {
  ConfigurationError,
  loadEnvironment,
} from "../src/config/environment.js";

const requiredEnvironment = {
  BSC_TESTNET_RPC_URL: "https://rpc.example.test",
};

describe("loadEnvironment", () => {
  it("loads the fixed testnet defaults without any private key", () => {
    const config = loadEnvironment(requiredEnvironment);

    expect(config.rpc.expectedChainId).toBe(BSC_TESTNET_CHAIN_ID);
    expect(config.contracts.rewardContractAddress).toBe(
      AURIX_REWARD_CONTRACT_ADDRESS,
    );
    expect(config.contracts.irbTokenAddress).toBe(IRB_TEST_TOKEN_ADDRESS);
    expect(config.database).toBeUndefined();
  });

  it("rejects a non-testnet chain ID", () => {
    expect(() =>
      loadEnvironment({
        ...requiredEnvironment,
        BSC_TESTNET_CHAIN_ID: "56",
      }),
    ).toThrow(ConfigurationError);
  });

  it("rejects a different reward contract", () => {
    expect(() =>
      loadEnvironment({
        ...requiredEnvironment,
        AURIX_REWARD_CONTRACT_ADDRESS:
          "0x0000000000000000000000000000000000000001",
      }),
    ).toThrow(ConfigurationError);
  });

  it("requires database identity fields as a group", () => {
    expect(() =>
      loadEnvironment({ ...requiredEnvironment, DB_HOST: "localhost" }),
    ).toThrow(ConfigurationError);
  });
});
