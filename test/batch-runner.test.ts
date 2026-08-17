import { ZeroHash } from "ethers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { presentBatchRun } from "../src/batch/batch-output.js";
import { runBatchExecution, runBatchPlan } from "../src/batch/batch-runner.js";
import type {
  BatchClaimLifecycle,
  BatchCommandArgs,
  BatchRunnerDependencies,
} from "../src/batch/batch-types.js";
import { ClaimExecutionError } from "../src/claim/claim-execution-error.js";
import type { AuthorizationJobRecord, AuthorizationPlanResult } from "../src/authorization/authorization-types.js";
import type { ClaimExecutionResult } from "../src/claim/claim-service.js";
import type { ClaimJobRecord, ClaimPlan } from "../src/claim/claim-types.js";
import type { PublicWalletRecord } from "../src/wallets/wallet-types.js";

const campaignId = `0x${"11".repeat(32)}`;
const args: BatchCommandArgs = {
  amount: 100n,
  campaignId,
  walletIdEnd: 10,
  walletIdStart: 1,
};

let harness: Harness;

beforeEach(() => {
  harness = createHarness();
});

describe("batch reward claim runner", () => {
  it("plans ten eligible wallets as authorization-required without transactions", async () => {
    const report = await runBatchPlan(args, harness.dependencies);
    expect(report.items).toHaveLength(10);
    expect(report.items.every((item) => item.action === "AUTHORIZATION_REQUIRED")).toBe(true);
    expect(report.items.every((item) => item.classification === "READY")).toBe(true);
    expect(report.transactionsSent).toBe(0);
  });

  it("reports mixed interval, eligible, gas, and unresolved states independently", async () => {
    harness.lifecycle.blocked.set("1", "BLOCKED_CLAIM_INTERVAL");
    harness.inspection.gasBalances.set(address(3), 0n);
    harness.claimJobs.unresolved.set("4", claimJob("4", "BROADCAST"));
    const report = await runBatchPlan({ ...args, walletIdEnd: 4 }, harness.dependencies);
    expect(report.items.map((item) => item.action)).toEqual([
      "BLOCKED_CLAIM_INTERVAL",
      "AUTHORIZATION_REQUIRED",
      "BLOCKED_INSUFFICIENT_USER_GAS",
      "UNRESOLVED_CLAIM_REQUIRES_RECONCILIATION",
    ]);
    expect(report.skipped).toBe(1);
    expect(report.blocked).toBe(1);
    expect(report.reconciliationRequired).toBe(1);
  });

  it("executes wallets sequentially with concurrency one", async () => {
    const report = await runBatchExecution(
      { ...args, walletIdEnd: 3 },
      harness.dependencies,
      true,
    );
    expect(harness.lifecycle.events).toEqual([
      "create:1", "execute:1", "create:2", "execute:2", "create:3", "execute:3",
    ]);
    expect(report.concurrency).toBe(1);
    expect(report.confirmed).toBe(3);
  });

  it("rejects execution before reconciliation when the guard is disabled", async () => {
    await expect(runBatchExecution(args, harness.dependencies, false))
      .rejects.toBeInstanceOf(ClaimExecutionError);
    expect(harness.lifecycle.reconcileSpy).not.toHaveBeenCalled();
    expect(harness.lifecycle.executeSpy).not.toHaveBeenCalled();
  });

  it("never creates an authorization or sends a transaction in plan mode", async () => {
    await runBatchPlan({ ...args, walletIdEnd: 2 }, harness.dependencies);
    expect(harness.lifecycle.createSpy).not.toHaveBeenCalled();
    expect(harness.lifecycle.executeSpy).not.toHaveBeenCalled();
    expect(harness.lifecycle.reconcileSpy).not.toHaveBeenCalled();
  });

  it("does not execute an interval-blocked wallet", async () => {
    harness.lifecycle.blocked.set("1", "BLOCKED_CLAIM_INTERVAL");
    const report = await runBatchExecution(
      { ...args, walletIdEnd: 1 },
      harness.dependencies,
      true,
    );
    expect(report.items[0]?.action).toBe("BLOCKED_CLAIM_INTERVAL");
    expect(harness.lifecycle.executeSpy).not.toHaveBeenCalled();
  });

  it("does not create or broadcast when an unresolved claim remains after reconciliation", async () => {
    harness.claimJobs.unresolved.set("1", claimJob("1", "PENDING_REVIEW"));
    const report = await runBatchExecution(
      { ...args, walletIdEnd: 1 },
      harness.dependencies,
      true,
    );
    expect(report.reconciliationRequired).toBe(1);
    expect(harness.lifecycle.createSpy).not.toHaveBeenCalled();
    expect(harness.lifecycle.executeSpy).not.toHaveBeenCalled();
  });

  it("sends one and only one claim transaction for a successful wallet", async () => {
    const report = await runBatchExecution(
      { ...args, walletIdEnd: 1 },
      harness.dependencies,
      true,
    );
    expect(harness.lifecycle.executeSpy).toHaveBeenCalledOnce();
    expect(report.transactionsSent).toBe(1);
    expect(report.confirmed).toBe(1);
  });

  it("continues after an expected wallet blocker", async () => {
    harness.lifecycle.blocked.set("1", "BLOCKED_CLAIM_INTERVAL");
    const report = await runBatchExecution(
      { ...args, walletIdEnd: 2 },
      harness.dependencies,
      true,
    );
    expect(report.items.map((item) => item.action)).toEqual([
      "BLOCKED_CLAIM_INTERVAL",
      "CLAIM_CONFIRMED",
    ]);
    expect(report.status).toBe("COMPLETED");
  });

  it("aborts remaining wallets on a systemic read failure", async () => {
    harness.lifecycle.systemErrors.add("2");
    const report = await runBatchExecution(
      { ...args, walletIdEnd: 3 },
      harness.dependencies,
      true,
    );
    expect(report.status).toBe("ABORTED_SYSTEM_ERROR");
    expect(report.processed).toBe(2);
    expect(report.items[1]).toMatchObject({
      action: "SYSTEM_ERROR",
      safeError: { code: "BATCH_SYSTEM_ERROR", type: "Error" },
    });
    expect(harness.lifecycle.events).not.toContain("create:3");
  });

  it("refreshes campaign budget and blocks later wallets when it is exhausted", async () => {
    harness.lifecycle.campaignBudget = 150n;
    harness.lifecycle.onConfirmed = () => {
      harness.lifecycle.campaignDistributed += 100n;
    };
    const report = await runBatchExecution(
      { ...args, walletIdEnd: 2 },
      harness.dependencies,
      true,
    );
    expect(report.items.map((item) => item.action)).toEqual([
      "CLAIM_CONFIRMED",
      "BLOCKED_CAMPAIGN_BUDGET",
    ]);
    expect(report.transactionsSent).toBe(1);
  });

  it("refreshes Reward Contract inventory and blocks later wallets when insufficient", async () => {
    harness.inspection.rewardContractBalance = 150n;
    harness.lifecycle.onConfirmed = () => {
      harness.inspection.rewardContractBalance -= 100n;
    };
    const report = await runBatchExecution(
      { ...args, walletIdEnd: 2 },
      harness.dependencies,
      true,
    );
    expect(report.items.map((item) => item.action)).toEqual([
      "CLAIM_CONFIRMED",
      "BLOCKED_REWARD_CONTRACT_IRB",
    ]);
  });

  it("requires reconciliation for a stale active authorization", async () => {
    harness.authorizationJobs.active.set("1", [authorization("1", 6n)]);
    const report = await runBatchPlan(
      { ...args, walletIdEnd: 1 },
      harness.dependencies,
    );
    expect(report.items[0]?.action).toBe("AUTHORIZATION_STALE_REQUIRES_RECONCILIATION");
    expect(report.reconciliationRequired).toBe(1);
  });

  it("prioritizes stale authorization reconciliation over a coincident interval skip", async () => {
    harness.authorizationJobs.active.set("1", [authorization("1", 6n)]);
    harness.lifecycle.blocked.set("1", "BLOCKED_CLAIM_INTERVAL");
    const report = await runBatchPlan(
      { ...args, walletIdEnd: 1 },
      harness.dependencies,
    );
    expect(report.items[0]?.action).toBe("AUTHORIZATION_STALE_REQUIRES_RECONCILIATION");
  });

  it("uses the existing expired-authorization reissue path", async () => {
    harness.authorizationJobs.active.set("1", [
      { ...authorization("1", 7n), deadline: 1_499n },
    ]);
    await runBatchExecution(
      { ...args, walletIdEnd: 1 },
      harness.dependencies,
      true,
    );
    expect(harness.lifecycle.createSpy).toHaveBeenCalledOnce();
    expect(harness.lifecycle.executeSpy).toHaveBeenCalledOnce();
  });

  it("does not reuse a consumed authorization", async () => {
    const consumed = { ...authorization("1", 6n), status: "CONSUMED" as const };
    harness.authorizationJobs.history.set("1", [consumed]);
    await runBatchExecution(
      { ...args, walletIdEnd: 1 },
      harness.dependencies,
      true,
    );
    const created = harness.lifecycle.created[0];
    expect(created?.jobId).not.toBe(consumed.jobId);
    expect(created?.rewardNonce).toBe(7n);
  });

  it("is replay-safe when the same batch is invoked again", async () => {
    harness.lifecycle.onConfirmed = (walletId) => {
      harness.lifecycle.blocked.set(walletId, "BLOCKED_CLAIM_INTERVAL");
    };
    const first = await runBatchExecution(
      { ...args, walletIdEnd: 1 },
      harness.dependencies,
      true,
    );
    const second = await runBatchExecution(
      { ...args, walletIdEnd: 1 },
      harness.dependencies,
      true,
    );
    expect(first.confirmed).toBe(1);
    expect(second.items[0]?.action).toBe("BLOCKED_CLAIM_INTERVAL");
    expect(harness.lifecycle.executeSpy).toHaveBeenCalledOnce();
  });

  it("accounts for confirmed, skipped, blocked, reconciliation, and fees", async () => {
    harness.lifecycle.blocked.set("2", "BLOCKED_CLAIM_INTERVAL");
    harness.inspection.gasBalances.set(address(3), 0n);
    harness.claimJobs.unresolved.set("4", claimJob("4", "SIGNED"));
    const report = await runBatchExecution(
      { ...args, walletIdEnd: 4 },
      harness.dependencies,
      true,
    );
    expect(report).toMatchObject({
      blocked: 1,
      confirmed: 1,
      reconciliationRequired: 1,
      requestedWallets: 4,
      skipped: 1,
      totalRewardAmount: 100n,
      transactionsSent: 1,
    });
  });

  it("does not expose secret-shaped lifecycle data in structured output", async () => {
    const report = await runBatchPlan(
      { ...args, walletIdEnd: 1 },
      harness.dependencies,
    );
    const output = JSON.stringify(presentBatchRun(report));
    expect(output).not.toMatch(/privateKey|rawTransaction|approverSignature|encryptionIv/);
    expect(output).not.toContain("test-secret-material");
  });

  it("stops after an uncertain claim so shared campaign state cannot be overcommitted", async () => {
    harness.lifecycle.results.set("1", "PENDING_REVIEW");
    const report = await runBatchExecution(
      { ...args, walletIdEnd: 3 },
      harness.dependencies,
      true,
    );
    expect(report.status).toBe("ABORTED_UNCERTAIN_CLAIM");
    expect(report.processed).toBe(1);
    expect(harness.lifecycle.events).toEqual(["create:1", "execute:1"]);
  });

  it("reuses a matching READY authorization and invokes the normal claim plan", async () => {
    const ready = authorization("1", 7n);
    harness.authorizationJobs.active.set("1", [ready]);
    const report = await runBatchPlan(
      { ...args, walletIdEnd: 1 },
      harness.dependencies,
    );
    expect(report.items[0]).toMatchObject({
      action: "CLAIM_READY",
      authorizationJobId: ready.jobId,
    });
    expect(harness.lifecycle.buildSpy).toHaveBeenCalledWith(ready, expect.anything(), undefined);
  });
});

interface Harness {
  readonly authorizationJobs: FakeAuthorizationJobs;
  readonly claimJobs: FakeClaimJobs;
  readonly dependencies: BatchRunnerDependencies;
  readonly inspection: FakeInspection;
  readonly lifecycle: FakeLifecycle;
}

function createHarness(): Harness {
  const wallets = new FakeWallets();
  const authorizationJobs = new FakeAuthorizationJobs();
  const claimJobs = new FakeClaimJobs();
  const inspection = new FakeInspection();
  const lifecycle = new FakeLifecycle(claimJobs);
  return {
    authorizationJobs,
    claimJobs,
    dependencies: {
      authorizationJobs,
      claimJobs,
      inspection,
      irbTokenAddress: address(901),
      lifecycle,
      rewardContractAddress: address(900),
      wallets,
    },
    inspection,
    lifecycle,
  };
}

class FakeWallets {
  public findPublicById(id: string): Promise<PublicWalletRecord | undefined> {
    const numeric = Number(id);
    if (numeric < 1 || numeric > 10) return Promise.resolve(undefined);
    return Promise.resolve(wallet(id));
  }

  public async findEncryptedById(id: string) {
    const publicWallet = await this.findPublicById(id);
    return publicWallet ? {
      ...publicWallet,
      encryptedPrivateKey: "ciphertext",
      encryptionAuthTag: "tag",
      encryptionIv: "iv",
      encryptionKeyVersion: 1,
      updatedAt: new Date(0),
    } : undefined;
  }
}

class FakeAuthorizationJobs {
  public readonly active = new Map<string, AuthorizationJobRecord[]>();
  public readonly history = new Map<string, AuthorizationJobRecord[]>();

  public listActiveByCampaignClaimant(
    campaign: string,
    claimant: string,
  ): Promise<readonly AuthorizationJobRecord[]> {
    void campaign;
    const walletId = String(Number.parseInt(claimant.slice(-2), 16));
    return Promise.resolve(this.active.get(walletId) ?? []);
  }
}

class FakeClaimJobs {
  public readonly byAuthorization = new Map<string, ClaimJobRecord>();
  public readonly unresolved = new Map<string, ClaimJobRecord>();

  public findByAuthorizationJobId(id: string): Promise<ClaimJobRecord | undefined> {
    return Promise.resolve(this.byAuthorization.get(id));
  }

  public findUnresolvedByWalletCampaign(
    walletId: string,
    campaign: string,
  ): Promise<ClaimJobRecord | undefined> {
    void campaign;
    return Promise.resolve(this.unresolved.get(walletId));
  }
}

class FakeInspection {
  public readonly gasBalances = new Map<string, bigint>();
  public rewardContractBalance = 10_000n;

  public getBalance(walletAddress: string): Promise<bigint> {
    return Promise.resolve(this.gasBalances.get(walletAddress) ?? 100_000n);
  }

  public getBlock(): Promise<{ readonly timestamp: number }> {
    return Promise.resolve({ timestamp: 1_500 });
  }

  public getFeeData(): Promise<{ readonly gasPrice: bigint }> {
    return Promise.resolve({ gasPrice: 1n });
  }

  public getIrbBalance(): Promise<bigint> {
    return Promise.resolve(0n);
  }

  public getRewardContractIrbBalance(): Promise<bigint> {
    return Promise.resolve(this.rewardContractBalance);
  }
}

class FakeLifecycle implements BatchClaimLifecycle {
  public readonly blocked = new Map<string, string>();
  public readonly buildSpy = vi.fn();
  public campaignBudget = 10_000n;
  public campaignDistributed = 0n;
  public readonly created: AuthorizationJobRecord[] = [];
  public readonly createSpy = vi.fn();
  public readonly events: string[] = [];
  public readonly executeSpy = vi.fn();
  public onConfirmed: (walletId: string) => void = () => undefined;
  public readonly reconcileSpy = vi.fn();
  public readonly results = new Map<string, ClaimExecutionResult["status"]>();
  public readonly systemErrors = new Set<string>();

  public constructor(private readonly claimJobs: FakeClaimJobs) {}

  public buildClaimPlan(
    authorizationJob: AuthorizationJobRecord,
    publicWallet: PublicWalletRecord,
    existingJob?: ClaimJobRecord,
  ): Promise<ClaimPlan> {
    this.buildSpy(authorizationJob, publicWallet, existingJob);
    return Promise.resolve(claimPlan(authorizationJob, existingJob));
  }

  public createAuthorization(publicWallet: PublicWalletRecord): Promise<AuthorizationJobRecord> {
    this.events.push(`create:${publicWallet.id}`);
    this.createSpy(publicWallet);
    const created = authorization(publicWallet.id, 7n, `created-${publicWallet.id}`);
    this.created.push(created);
    return Promise.resolve(created);
  }

  public executeClaim(
    authorizationJob: AuthorizationJobRecord,
  ): Promise<ClaimExecutionResult> {
    const walletId = authorizationJob.walletId;
    this.events.push(`execute:${walletId}`);
    this.executeSpy(authorizationJob);
    const status = this.results.get(walletId) ?? "CONFIRMED";
    const result = {
      claimJobId: `claim-${walletId}`,
      status,
      transactionsSent: 1,
      txHash: `0x${walletId.padStart(64, "0")}`,
    } as const;
    this.claimJobs.byAuthorization.set(
      authorizationJob.jobId,
      { ...claimJob(walletId, status === "PENDING_REVIEW" ? status : "CONFIRMED"), feePaidWei: 25n },
    );
    if (status === "CONFIRMED") this.onConfirmed(walletId);
    return Promise.resolve(result);
  }

  public getRewardNonce(): Promise<bigint> {
    return Promise.resolve(7n);
  }

  public isRewardIdUsed(): Promise<boolean> {
    return Promise.resolve(false);
  }

  public planAuthorization(
    publicWallet: PublicWalletRecord,
  ): Promise<AuthorizationPlanResult> {
    if (this.systemErrors.has(publicWallet.id)) {
      return Promise.reject(new Error("unsafe provider details and test-secret-material"));
    }
    const code = this.blocked.get(publicWallet.id);
    if (code) {
      return Promise.resolve({
        code: code as Extract<AuthorizationPlanResult, { status: "BLOCKED" }>["code"],
        reason: "Expected deterministic blocker",
        status: "BLOCKED",
        transactionsSent: 0,
      });
    }
    if (this.campaignDistributed + args.amount > this.campaignBudget) {
      return Promise.resolve({
        code: "BLOCKED_CAMPAIGN_BUDGET",
        reason: "Campaign remaining budget is insufficient",
        status: "BLOCKED",
        transactionsSent: 0,
      });
    }
    return Promise.resolve(authorizationPlan(
      publicWallet,
      this.campaignBudget,
      this.campaignDistributed,
    ));
  }

  public reconcileClaims(): Promise<{ readonly inspected: number; readonly updated: number }> {
    this.reconcileSpy();
    return Promise.resolve({ inspected: this.claimJobs.unresolved.size, updated: 0 });
  }
}

function authorizationPlan(
  publicWallet: PublicWalletRecord,
  budget: bigint,
  distributed: bigint,
): Extract<AuthorizationPlanResult, { status: "READY_TO_AUTHORIZE" }> {
  return {
    authorization: {
      amount: args.amount,
      campaignId,
      claimant: publicWallet.walletAddress,
      deadline: 2_000n,
      rewardId: ZeroHash,
      rewardNonce: 7n,
      validAfter: 1_500n,
    },
    campaign: {
      active: true,
      budget,
      claimInterval: 3_600n,
      distributed,
      endTime: 3_000n,
      exists: true,
      maxRewardAmount: args.amount,
      startTime: 1_000n,
    },
    claimantState: {
      claimIntervalElapsed: true,
      lastClaimAt: 0n,
      nextClaimAt: 0n,
      rewardNonce: 7n,
    },
    eligibility: {
      eligible: true,
      reason: "TEST",
      source: "TEST_ELIGIBILITY",
    },
    status: "READY_TO_AUTHORIZE",
    transactionsSent: 0,
  };
}

function authorization(
  walletId: string,
  rewardNonce: bigint,
  jobId = `authorization-${walletId}-${rewardNonce.toString()}`,
): AuthorizationJobRecord {
  return {
    amount: args.amount,
    approverAddress: address(800),
    approverSignature: "public-signature",
    campaignId,
    claimant: address(Number(walletId)),
    deadline: 2_000n,
    jobId,
    rewardId: `0x${walletId.padStart(64, "0")}`,
    rewardNonce,
    status: "READY",
    typedDataHash: ZeroHash,
    validAfter: 1_000n,
    walletId,
  };
}

function claimPlan(
  authorizationJob: AuthorizationJobRecord,
  existingJob?: ClaimJobRecord,
): ClaimPlan {
  return {
    authorization: authorizationJob,
    blockers: [],
    campaign: authorizationPlan(wallet(authorizationJob.walletId), 10_000n, 0n).campaign,
    claimantState: authorizationPlan(wallet(authorizationJob.walletId), 10_000n, 0n).claimantState,
    currentEthereumTxNonce: 1,
    estimatedFeeWei: 30n,
    estimatedGas: 25n,
    expectedAction: existingJob?.status === "CONFIRMED"
      ? "SKIP_ALREADY_CONFIRMED"
      : "SIGN_AND_BROADCAST",
    gasLimit: 30n,
    gasPriceWei: 1n,
    irbBalance: 0n,
    latestBlockTimestamp: 1_500n,
    recoveredApprover: address(800),
    rewardContractIrbBalance: 10_000n,
    transaction: { to: address(900) },
    transactionsSent: 0,
    userGasBalanceWei: 100_000n,
    walletAddress: authorizationJob.claimant,
  };
}

function claimJob(walletId: string, status: ClaimJobRecord["status"]): ClaimJobRecord {
  return {
    amount: args.amount,
    authorizationJobId: `authorization-${walletId}`,
    campaignDistributedBefore: 0n,
    campaignId,
    claimant: address(Number(walletId)),
    gasLimit: 30n,
    gasPriceWei: 1n,
    irbBalanceBefore: 0n,
    jobId: `claim-${walletId}`,
    rewardContractBalanceBefore: 10_000n,
    rewardId: `0x${walletId.padStart(64, "0")}`,
    rewardNonce: 7n,
    signedTxHash: `0x${walletId.padStart(64, "0")}`,
    status,
    txNonce: 1,
    walletId,
  };
}

function wallet(id: string): PublicWalletRecord {
  return {
    createdAt: new Date(0),
    id,
    status: "ACTIVE",
    walletAddress: address(Number(id)),
  };
}

function address(value: number): string {
  return `0x${value.toString(16).padStart(40, "0")}`;
}
