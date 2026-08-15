import { keccak256, Wallet, parseEther, parseUnits } from "ethers";
import { describe, expect, it, vi } from "vitest";

import {
  campaignInterface,
  irbTransferInterface,
  OPERATIONS_TBNB_EXECUTION_TARGET,
  REWARD_CONTRACT_IRB_TARGET,
} from "../src/campaign/campaign-execution-plan.js";
import {
  executeTestCampaignWorkflow,
  validateCampaignCreated,
  validateTransfer,
  type ExecuteCampaignInput,
} from "../src/campaign/campaign-execution-service.js";
import { createTestCampaignProposal, emptyCampaign } from "../src/campaign/campaign-plan.js";
import type {
  CampaignEvidenceRecord,
  CampaignEvidenceRepository,
  CampaignExecutionProvider,
  CampaignReceipt,
  CampaignReader,
  IrbReader,
  SignedCampaignEvidenceInput,
} from "../src/campaign/campaign-execution-types.js";
import {
  AURIX_REWARD_CONTRACT_ADDRESS,
  IRB_TEST_TOKEN_ADDRESS,
  TESTNET_ADMIN_ADDRESS,
  TESTNET_IRB_TOKEN_OWNER_ADDRESS,
  TESTNET_OPERATIONS_ADDRESS,
} from "../src/config/constants.js";

class Evidence implements CampaignEvidenceRepository {
  public readonly signed: SignedCampaignEvidenceInput[] = [];
  public readonly states: string[] = [];
  public insertSigned(input: SignedCampaignEvidenceInput): Promise<void> {
    this.signed.push(input); this.states.push("SIGNED"); return Promise.resolve();
  }
  public listAll(): Promise<readonly CampaignEvidenceRecord[]> { return Promise.resolve([]); }
  public listUnresolved(): Promise<readonly CampaignEvidenceRecord[]> { return Promise.resolve([]); }
  public markBroadcast(): Promise<void> { this.states.push("BROADCAST"); return Promise.resolve(); }
  public markConfirmed(): Promise<void> { this.states.push("CONFIRMED"); return Promise.resolve(); }
  public markFailed(): Promise<void> { this.states.push("FAILED"); return Promise.resolve(); }
  public markPendingReview(): Promise<void> { this.states.push("PENDING_REVIEW"); return Promise.resolve(); }
}

const admin = Wallet.createRandom();
const operations = Wallet.createRandom();
const owner = Wallet.createRandom();

function matchingCampaign() {
  return {
    active: true,
    budget: parseUnits("3", 18),
    claimInterval: 3_600n,
    distributed: 0n,
    endTime: 1_700_604_800n,
    exists: true,
    maxRewardAmount: parseUnits("0.1", 18),
    startTime: 1_700_000_000n,
  };
}

function executionInput(options: {
  readonly campaign?: ReturnType<typeof emptyCampaign>;
  readonly contractIrb?: bigint;
  readonly ownerIrb?: bigint;
  readonly receiptStatus?: number;
  readonly timeout?: boolean;
  readonly operationsBalance?: bigint;
  readonly adminBalance?: bigint;
} = {}): ExecuteCampaignInput & { provider: CampaignExecutionProvider; evidence: Evidence; broadcast: ReturnType<typeof vi.fn> } {
  const evidence = new Evidence();
  const broadcast = vi.fn((raw: string) => Promise.resolve({
    hash: keccak256(raw),
    wait: options.timeout
      ? vi.fn().mockRejectedValue(new Error("timeout"))
      : vi.fn().mockResolvedValue({
          blockNumber: 1,
          gasPrice: 100_000_000n,
          gasUsed: 100_000n,
          hash: "unused",
          logs: [],
          status: options.receiptStatus ?? 1,
        } satisfies CampaignReceipt),
  }));
  const provider: CampaignExecutionProvider = {
    broadcastTransaction: broadcast,
    estimateGas: vi.fn().mockResolvedValue(100_000n),
    getBalance: vi.fn((address: string) => Promise.resolve(
      address === TESTNET_OPERATIONS_ADDRESS || address === operations.address
        ? (options.operationsBalance ?? OPERATIONS_TBNB_EXECUTION_TARGET)
        : address === TESTNET_ADMIN_ADDRESS
          ? (options.adminBalance ?? parseEther("1"))
          : parseEther("1"),
    )),
    getBlock: vi.fn().mockResolvedValue({ number: 1, timestamp: 1_800_000_000 }),
    getCode: vi.fn().mockResolvedValue("0x6000"),
    getFeeData: vi.fn().mockResolvedValue({ gasPrice: 100_000_000n }),
    getNetwork: vi.fn().mockResolvedValue({ chainId: 97n }),
    getTransaction: vi.fn().mockResolvedValue(null),
    getTransactionCount: vi.fn().mockResolvedValue(1),
    getTransactionReceipt: vi.fn().mockResolvedValue(null),
  };
  const campaign = options.campaign ?? matchingCampaign();
  const rewardClient: CampaignReader = {
    getCampaign: vi.fn().mockResolvedValue(campaign),
    getClaimIntervalBounds: vi.fn().mockResolvedValue({ minimum: 3_600n, maximum: 604_800n }),
    getRoleId: vi.fn().mockResolvedValue(`0x${"11".repeat(32)}`),
    hasRole: vi.fn().mockResolvedValue(true),
    isPaused: vi.fn().mockResolvedValue(false),
  };
  const irbClient: IrbReader = {
    balanceOf: vi.fn((address: string) => Promise.resolve(
      address === AURIX_REWARD_CONTRACT_ADDRESS
        ? (options.contractIrb ?? REWARD_CONTRACT_IRB_TARGET)
        : (options.ownerIrb ?? parseUnits("100", 18)),
    )),
    owner: vi.fn().mockResolvedValue(TESTNET_IRB_TOKEN_OWNER_ADDRESS),
  };
  return {
    broadcast,
    broadcastProviders: [provider],
    config: {
      adminPrivateKey: admin.privateKey,
      executionEnabled: true,
      irbTokenOwnerExpectedAddress: TESTNET_IRB_TOKEN_OWNER_ADDRESS,
      irbTokenOwnerPrivateKey: owner.privateKey,
      maxGasPriceWei: undefined,
      operationsExpectedAddress: operations.address,
      operationsPrivateKey: operations.privateKey,
    },
    evidence,
    irbClient,
    preflight: vi.fn().mockResolvedValue({ status: "READY_FOR_OWNER_EXECUTION" }),
    primaryProvider: provider,
    provider,
    repository: evidence,
    rewardClient,
  };
}

describe("campaign execution workflow", () => {
  it("blocks all transaction sending while execution is disabled", async () => {
    const input = executionInput();
    await expect(executeTestCampaignWorkflow({
      ...input,
      config: { ...input.config, executionEnabled: false },
    })).rejects.toThrow("execution is disabled");
    expect(input.broadcast).not.toHaveBeenCalled();
  });

  it("reruns idempotently when all three targets already exist", async () => {
    const input = executionInput({ operationsBalance: 0n });
    await expect(executeTestCampaignWorkflow({
      ...input,
      config: {
        ...input.config,
        adminPrivateKey: undefined,
        irbTokenOwnerPrivateKey: undefined,
        operationsPrivateKey: undefined,
      },
    })).resolves.toMatchObject({
      status: "COMPLETED",
      steps: {
        campaignCreate: "SKIP_ALREADY_CREATED",
        irbTransfer: "SKIP_TARGET_REACHED",
        operationsTopUp: "SKIP_NOT_REQUIRED",
      },
      transactionsSent: 0,
    });
    expect(input.broadcast).not.toHaveBeenCalled();
  });

  it("stops for owner review when an existing campaign mismatches", async () => {
    const input = executionInput({ campaign: { ...matchingCampaign(), budget: 1n } });
    await expect(executeTestCampaignWorkflow(input)).rejects.toThrow("differ");
    expect(input.broadcast).not.toHaveBeenCalled();
  });

  it("rejects insufficient Admin tBNB before TX 1", async () => {
    const input = executionInput({
      adminBalance: 0n,
      campaign: emptyCampaign(),
      operationsBalance: 0n,
    });
    await expect(executeTestCampaignWorkflow(input)).rejects.toThrow("Admin tBNB");
    expect(input.broadcast).not.toHaveBeenCalled();
  });

  it("rejects insufficient owner IRB before TX 3", async () => {
    const input = executionInput({ contractIrb: 0n, ownerIrb: 0n });
    await expect(executeTestCampaignWorkflow(input)).rejects.toThrow("Owner balance");
    expect(input.broadcast).not.toHaveBeenCalled();
  });

  it("a failed create receipt blocks the IRB step", async () => {
    const input = executionInput({ campaign: emptyCampaign(), contractIrb: 0n, receiptStatus: 0 });
    await expect(executeTestCampaignWorkflow(input)).resolves.toMatchObject({
      status: "STOPPED_FAILED",
      steps: { campaignCreate: "FAILED", irbTransfer: "NOT_RUN" },
      transactionsSent: 1,
    });
    expect(input.broadcast).toHaveBeenCalledTimes(1);
    expect(input.evidence.states).toContain("FAILED");
  });

  it("a pending receipt remains unresolved and blocks the IRB step", async () => {
    const input = executionInput({ campaign: emptyCampaign(), contractIrb: 0n, timeout: true });
    await expect(executeTestCampaignWorkflow(input)).resolves.toMatchObject({
      status: "STOPPED_PENDING_REVIEW",
      steps: { campaignCreate: "PENDING_REVIEW", irbTransfer: "NOT_RUN" },
      transactionsSent: 1,
    });
    expect(input.broadcast).toHaveBeenCalledTimes(1);
    expect(input.evidence.states).toContain("PENDING_REVIEW");
    expect(input.evidence.states).not.toContain("FAILED");
  });
});

describe("campaign receipt validation", () => {
  it("accepts only the exact CampaignCreated event", () => {
    const proposal = createTestCampaignProposal(1_800_000_000);
    const event = campaignInterface.getEvent("CampaignCreated");
    const encoded = campaignInterface.encodeEventLog(event, [
      proposal.campaignId, proposal.budget, proposal.maxRewardAmount,
      proposal.startTime, proposal.endTime, proposal.claimInterval, proposal.active,
    ]);
    const receipt = {
      blockNumber: 1, gasPrice: 1n, gasUsed: 1n, hash: `0x${"12".repeat(32)}`,
      logs: [{ address: AURIX_REWARD_CONTRACT_ADDRESS, ...encoded }], status: 1,
    } satisfies CampaignReceipt;
    expect(validateCampaignCreated(receipt, proposal)).toBe(true);
    expect(validateCampaignCreated({ ...receipt, logs: [] }, proposal)).toBe(false);
  });

  it("accepts only the exact IRB Transfer event", () => {
    const amount = parseUnits("3.3", 18);
    const event = irbTransferInterface.getEvent("Transfer");
    const encoded = irbTransferInterface.encodeEventLog(event, [
      TESTNET_IRB_TOKEN_OWNER_ADDRESS, AURIX_REWARD_CONTRACT_ADDRESS, amount,
    ]);
    const receipt = {
      blockNumber: 1, gasPrice: 1n, gasUsed: 1n, hash: `0x${"34".repeat(32)}`,
      logs: [{ address: IRB_TEST_TOKEN_ADDRESS, ...encoded }], status: 1,
    } satisfies CampaignReceipt;
    expect(validateTransfer(receipt, TESTNET_IRB_TOKEN_OWNER_ADDRESS, amount)).toBe(true);
    expect(validateTransfer(receipt, TESTNET_IRB_TOKEN_OWNER_ADDRESS, amount - 1n)).toBe(false);
  });
});
