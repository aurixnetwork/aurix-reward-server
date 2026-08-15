import { parseEther, parseUnits, type TransactionRequest } from "ethers";
import { describe, expect, it, vi } from "vitest";

import {
  campaignInterface,
  createCampaignExecutionPreflight,
  encodeCreateCampaign,
  OPERATIONS_TBNB_EXECUTION_TARGET,
  REWARD_CONTRACT_IRB_TARGET,
  TEST_CAMPAIGN_ID,
} from "../src/campaign/campaign-execution-plan.js";
import { emptyCampaign } from "../src/campaign/campaign-plan.js";
import {
  AURIX_REWARD_CONTRACT_ADDRESS,
  IRB_TEST_TOKEN_ADDRESS,
  TESTNET_ADMIN_ADDRESS,
  TESTNET_IRB_TOKEN_OWNER_ADDRESS,
  TESTNET_OPERATIONS_ADDRESS,
} from "../src/config/constants.js";
import type { CampaignExecutionEnvironmentConfig } from "../src/config/environment.js";
import type {
  CampaignExecutionProvider,
  CampaignReader,
  IrbReader,
} from "../src/campaign/campaign-execution-types.js";

function campaignConfig(): CampaignExecutionEnvironmentConfig {
  return {
    adminPrivateKey: undefined,
    executionEnabled: false,
    irbTokenOwnerExpectedAddress: TESTNET_IRB_TOKEN_OWNER_ADDRESS,
    irbTokenOwnerPrivateKey: undefined,
    maxGasPriceWei: 1_000_000_000n,
    operationsExpectedAddress: TESTNET_OPERATIONS_ADDRESS,
    operationsPrivateKey: undefined,
  };
}

const testSignerAddresses: Readonly<Record<string, string>> = {
  "admin-test-key": TESTNET_ADMIN_ADDRESS,
  "operations-test-key": TESTNET_OPERATIONS_ADDRESS,
  "owner-test-key": TESTNET_IRB_TOKEN_OWNER_ADDRESS,
};

function verifiedCampaignConfig(options: {
  readonly admin?: boolean;
  readonly irbTokenOwner?: boolean;
  readonly operations?: boolean;
} = {}): CampaignExecutionEnvironmentConfig {
  return {
    ...campaignConfig(),
    adminPrivateKey: options.admin === false ? undefined : "admin-test-key",
    irbTokenOwnerPrivateKey: options.irbTokenOwner === false ? undefined : "owner-test-key",
    operationsPrivateKey: options.operations === false ? undefined : "operations-test-key",
  };
}

function deriveTestSignerAddress(privateKey: string): string {
  const address = testSignerAddresses[privateKey];
  if (!address) throw new Error("Unknown deterministic test signer");
  return address;
}

function provider(balances: Readonly<Record<string, bigint>> = {}): CampaignExecutionProvider {
  return {
    broadcastTransaction: vi.fn(() => { throw new Error("preflight must not broadcast"); }),
    estimateGas: vi.fn((transaction: TransactionRequest) => Promise.resolve(
      transaction.to === AURIX_REWARD_CONTRACT_ADDRESS ? 100_000n
        : transaction.to === IRB_TEST_TOKEN_ADDRESS ? 55_000n : 21_000n,
    )),
    getBalance: vi.fn((address: string) => Promise.resolve(
      balances[address] ?? (address === TESTNET_OPERATIONS_ADDRESS ? 0n : parseEther("1")),
    )),
    getBlock: vi.fn().mockResolvedValue({ number: 50, timestamp: 1_800_000_000 }),
    getCode: vi.fn().mockResolvedValue("0x6000"),
    getFeeData: vi.fn().mockResolvedValue({ gasPrice: 100_000_000n }),
    getNetwork: vi.fn().mockResolvedValue({ chainId: 97n }),
    getTransaction: vi.fn().mockResolvedValue(null),
    getTransactionCount: vi.fn().mockResolvedValue(1),
    getTransactionReceipt: vi.fn().mockResolvedValue(null),
  };
}

function rewardReader(options: {
  readonly campaign?: ReturnType<typeof emptyCampaign>;
  readonly role?: boolean;
} = {}): CampaignReader {
  return {
    getCampaign: vi.fn().mockResolvedValue(options.campaign ?? emptyCampaign()),
    getClaimIntervalBounds: vi.fn().mockResolvedValue({ maximum: 604_800n, minimum: 3_600n }),
    getRoleId: vi.fn().mockResolvedValue(`0x${"11".repeat(32)}`),
    hasRole: vi.fn().mockResolvedValue(options.role ?? true),
    isPaused: vi.fn().mockResolvedValue(false),
  };
}

function irbReader(ownerBalance = parseUnits("100", 18), contractBalance = 0n): IrbReader {
  return {
    balanceOf: vi.fn((address: string) => Promise.resolve(
      address === AURIX_REWARD_CONTRACT_ADDRESS ? contractBalance : ownerBalance,
    )),
    owner: vi.fn().mockResolvedValue(TESTNET_IRB_TOKEN_OWNER_ADDRESS),
  };
}

describe("campaign execution preflight", () => {
  it("is zero-transaction tooling with exact calldata and execution timestamps", async () => {
    const rpc = provider();
    const result = await createCampaignExecutionPreflight({
      campaignConfig: campaignConfig(),
      irbClient: irbReader(),
      provider: rpc,
      rewardClient: rewardReader(),
    });
    expect(result.transactionsSent).toBe(0);
    expect(result.proposal.startTime).toBe(1_800_000_600n);
    expect(result.proposal.endTime).toBe(1_800_605_400n);
    expect(result.operationsTopUpWei).toBe(OPERATIONS_TBNB_EXECUTION_TARGET);
    expect(result.requiredIrbTransfer).toBe(REWARD_CONTRACT_IRB_TARGET);
    const create = result.transactions.find((transaction) => transaction.kind === "CAMPAIGN_CREATE");
    expect(create?.calldata).toBe(encodeCreateCampaign(result.proposal));
    const decoded = campaignInterface.decodeFunctionData("createCampaign", create?.calldata ?? "0x");
    expect(decoded.toArray()).toEqual([
      TEST_CAMPAIGN_ID,
      parseUnits("3", 18),
      parseUnits("0.1", 18),
      1_800_000_600n,
      1_800_605_400n,
      3_600n,
      true,
    ]);
  });

  it("uses target logic to avoid duplicate Operations and IRB transfers", async () => {
    const result = await createCampaignExecutionPreflight({
      campaignConfig: campaignConfig(),
      irbClient: irbReader(parseUnits("100", 18), REWARD_CONTRACT_IRB_TARGET),
      provider: provider({ [TESTNET_OPERATIONS_ADDRESS]: OPERATIONS_TBNB_EXECUTION_TARGET }),
      rewardClient: rewardReader(),
    });
    expect(result.operationsTopUpWei).toBe(0n);
    expect(result.requiredIrbTransfer).toBe(0n);
    expect(result.transactions.map((transaction) => transaction.kind)).toEqual(["CAMPAIGN_CREATE"]);
  });

  it("prevents duplicate creation but stops a mismatching existing campaign", async () => {
    const baseline = {
      active: true,
      budget: parseUnits("3", 18),
      claimInterval: 3_600n,
      distributed: 0n,
      endTime: 1_700_604_800n,
      exists: true,
      maxRewardAmount: parseUnits("0.1", 18),
      startTime: 1_700_000_000n,
    };
    const matching = await createCampaignExecutionPreflight({
      campaignConfig: campaignConfig(), irbClient: irbReader(), provider: provider(),
      rewardClient: rewardReader({ campaign: baseline }),
    });
    expect(matching.campaignAction).toBe("SKIP_ALREADY_CREATED");
    expect(matching.transactions.some((transaction) => transaction.kind === "CAMPAIGN_CREATE"))
      .toBe(false);

    const mismatch = await createCampaignExecutionPreflight({
      campaignConfig: campaignConfig(), irbClient: irbReader(), provider: provider(),
      rewardClient: rewardReader({ campaign: { ...baseline, budget: 1n } }),
    });
    expect(mismatch.campaignAction).toBe("STOP_MISMATCH");
    expect(mismatch.checks).toContainEqual({ name: "campaign_not_mismatched", passed: false });
  });

  it("fails role, tBNB, IRB, signer, and maximum-gas protections closed", async () => {
    const config = { ...campaignConfig(), maxGasPriceWei: 1n };
    const result = await createCampaignExecutionPreflight({
      campaignConfig: config,
      irbClient: irbReader(0n),
      provider: provider({
        [TESTNET_ADMIN_ADDRESS]: 0n,
        [TESTNET_IRB_TOKEN_OWNER_ADDRESS]: 0n,
        [TESTNET_OPERATIONS_ADDRESS]: 0n,
      }),
      rewardClient: rewardReader({ role: false }),
    });
    expect(result.status).toBe("BLOCKED");
    for (const check of [
      "operations_campaign_manager_role",
      "admin_key_address",
      "operations_key_address",
      "irb_token_owner_key_address",
      "admin_tbnb",
      "token_owner_tbnb",
      "token_owner_irb",
      "gas_price_maximum",
    ]) {
      expect(result.checks).toContainEqual({ name: check, passed: false });
    }
  });
});

describe("action-conditional campaign signer requirements", () => {
  it("blocks a missing IRB owner only when an IRB transfer is required", async () => {
    const blocked = await createCampaignExecutionPreflight({
      campaignConfig: verifiedCampaignConfig({ irbTokenOwner: false }),
      deriveSignerAddress: deriveTestSignerAddress,
      irbClient: irbReader(parseUnits("100", 18), 0n),
      provider: provider(),
      rewardClient: rewardReader(),
    });
    expect(blocked.status).toBe("BLOCKED");
    expect(blocked.signers[2]).toMatchObject({
      required: true,
      status: "REQUIRED_MISSING",
    });

    const ready = await createCampaignExecutionPreflight({
      campaignConfig: verifiedCampaignConfig({ irbTokenOwner: false }),
      deriveSignerAddress: deriveTestSignerAddress,
      irbClient: irbReader(parseUnits("100", 18), REWARD_CONTRACT_IRB_TARGET),
      provider: provider(),
      rewardClient: rewardReader(),
    });
    expect(ready.status).toBe("READY_FOR_OWNER_EXECUTION");
    expect(ready.signers[2]).toMatchObject({
      configured: false,
      required: false,
      status: "SKIPPED_NOT_REQUIRED",
    });
    expect(ready.transactions.map((transaction) => transaction.kind)).toEqual([
      "TBNB_GAS_TOPUP",
      "CAMPAIGN_CREATE",
    ]);
  });

  it("blocks a missing Admin only when the Operations top-up is required", async () => {
    const blocked = await createCampaignExecutionPreflight({
      campaignConfig: verifiedCampaignConfig({ admin: false }),
      deriveSignerAddress: deriveTestSignerAddress,
      irbClient: irbReader(parseUnits("100", 18), REWARD_CONTRACT_IRB_TARGET),
      provider: provider(),
      rewardClient: rewardReader(),
    });
    expect(blocked.status).toBe("BLOCKED");
    expect(blocked.signers[0]?.status).toBe("REQUIRED_MISSING");

    const ready = await createCampaignExecutionPreflight({
      campaignConfig: verifiedCampaignConfig({ admin: false }),
      deriveSignerAddress: deriveTestSignerAddress,
      irbClient: irbReader(parseUnits("100", 18), REWARD_CONTRACT_IRB_TARGET),
      provider: provider({ [TESTNET_OPERATIONS_ADDRESS]: OPERATIONS_TBNB_EXECUTION_TARGET }),
      rewardClient: rewardReader(),
    });
    expect(ready.status).toBe("READY_FOR_OWNER_EXECUTION");
    expect(ready.signers[0]).toMatchObject({
      required: false,
      status: "SKIPPED_NOT_REQUIRED",
    });
  });

  it("requires Operations only while campaign creation is required", async () => {
    const blocked = await createCampaignExecutionPreflight({
      campaignConfig: verifiedCampaignConfig({ operations: false }),
      deriveSignerAddress: deriveTestSignerAddress,
      irbClient: irbReader(parseUnits("100", 18), REWARD_CONTRACT_IRB_TARGET),
      provider: provider({ [TESTNET_OPERATIONS_ADDRESS]: OPERATIONS_TBNB_EXECUTION_TARGET }),
      rewardClient: rewardReader(),
    });
    expect(blocked.status).toBe("BLOCKED");
    expect(blocked.signers[1]?.status).toBe("REQUIRED_MISSING");

    const existing = {
      active: true,
      budget: parseUnits("3", 18),
      claimInterval: 3_600n,
      distributed: 0n,
      endTime: 1_700_604_800n,
      exists: true,
      maxRewardAmount: parseUnits("0.1", 18),
      startTime: 1_700_000_000n,
    };
    const ready = await createCampaignExecutionPreflight({
      campaignConfig: verifiedCampaignConfig({ operations: false }),
      deriveSignerAddress: deriveTestSignerAddress,
      irbClient: irbReader(),
      provider: provider(),
      rewardClient: rewardReader({ campaign: existing, role: false }),
    });
    expect(ready.signers[1]).toMatchObject({
      required: false,
      status: "SKIPPED_NOT_REQUIRED",
    });
    expect(ready.transactions.some((transaction) => transaction.kind === "CAMPAIGN_CREATE"))
      .toBe(false);
  });

  it("requires no signer and plans zero transactions when all actions are satisfied", async () => {
    const existing = {
      active: true,
      budget: parseUnits("3", 18),
      claimInterval: 3_600n,
      distributed: 0n,
      endTime: 1_700_604_800n,
      exists: true,
      maxRewardAmount: parseUnits("0.1", 18),
      startTime: 1_700_000_000n,
    };
    const result = await createCampaignExecutionPreflight({
      campaignConfig: campaignConfig(),
      irbClient: irbReader(parseUnits("100", 18), REWARD_CONTRACT_IRB_TARGET),
      provider: provider({ [TESTNET_OPERATIONS_ADDRESS]: OPERATIONS_TBNB_EXECUTION_TARGET }),
      rewardClient: rewardReader({ campaign: existing }),
    });
    expect(result.status).toBe("SKIP_ALREADY_CREATED");
    expect(result.transactions).toHaveLength(0);
    expect(result.transactionsSent).toBe(0);
    expect(result.signers.map((signer) => signer.status)).toEqual([
      "SKIPPED_NOT_REQUIRED",
      "SKIPPED_NOT_REQUIRED",
      "SKIPPED_NOT_REQUIRED",
    ]);
  });
});
