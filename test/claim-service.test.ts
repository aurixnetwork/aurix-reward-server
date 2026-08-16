import { parseEther, Transaction, Wallet } from "ethers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthorizationRepository } from "../src/authorization/authorization-repository.js";
import type { AuthorizationJobRecord } from "../src/authorization/authorization-types.js";
import { rewardClaimInterface } from "../src/claim/claim-codec.js";
import { ClaimExecutionError } from "../src/claim/claim-execution-error.js";
import { ClaimPersistenceError } from "../src/claim/claim-persistence-error.js";
import type { ClaimRepository, ConfirmedClaimInput } from "../src/claim/claim-repository.js";
import { executeClaim, reconcileClaimJobs } from "../src/claim/claim-service.js";
import type {
  ClaimChainReader,
  ClaimJobRecord,
  ClaimPlan,
  ClaimProvider,
  ClaimReceipt,
  ClaimTokenReader,
  SignedClaimJobInput,
} from "../src/claim/claim-types.js";
import { AURIX_REWARD_CONTRACT_ADDRESS } from "../src/config/constants.js";
import { encryptWalletPrivateKey } from "../src/wallets/wallet-crypto.js";
import type { EncryptedWalletRecord } from "../src/wallets/wallet-types.js";

const userWallet = new Wallet(`0x${"44".repeat(32)}`);
const approverWallet = new Wallet(`0x${"55".repeat(32)}`);
const encryptionKey = Buffer.alloc(32, 7);
const amount = parseEther("0.1");
const campaignId = `0x${"11".repeat(32)}`;
const rewardId = `0x${"22".repeat(32)}`;
const authorization: AuthorizationJobRecord = {
  amount,
  approverAddress: approverWallet.address,
  approverSignature: `0x${"33".repeat(65)}`,
  campaignId,
  claimant: userWallet.address,
  deadline: 3_000n,
  jobId: "0d4ebebf-82f2-4d1a-a7df-c09a4db256ae",
  rewardId,
  rewardNonce: 7n,
  status: "READY",
  typedDataHash: `0x${"99".repeat(32)}`,
  validAfter: 1_000n,
  walletId: "1",
};

let repository: FakeClaimRepository;
let provider: ClaimProvider & { readonly broadcastSpy: ReturnType<typeof vi.fn> };
let walletRecord: EncryptedWalletRecord;
let plan: ClaimPlan;
let receipt: ClaimReceipt;
let reader: ClaimChainReader;
let token: ClaimTokenReader;

beforeEach(() => {
  repository = new FakeClaimRepository();
  walletRecord = {
    ...encryptWalletPrivateKey(userWallet.privateKey, userWallet.address, encryptionKey, 1),
    createdAt: new Date(0),
    id: "1",
    status: "ACTIVE",
    updatedAt: new Date(0),
    walletAddress: userWallet.address,
  };
  const event = rewardClaimInterface.encodeEventLog(
    rewardClaimInterface.getEvent("RewardClaimed"),
    [campaignId, rewardId, userWallet.address, approverWallet.address, amount, 7n, 2_100n],
  );
  receipt = {
    blockNumber: 123,
    gasPrice: 3_000_000_000n,
    gasUsed: 90_000n,
    hash: `0x${"77".repeat(32)}`,
    logs: [{
      address: AURIX_REWARD_CONTRACT_ADDRESS,
      data: event.data,
      index: 0,
      topics: event.topics,
    }],
    status: 1,
  };
  const broadcastSpy = vi.fn((raw: string) => {
    const transaction = Transaction.from(raw);
    repository.events.push(`RPC:${transaction.from ?? "missing"}`);
    return Promise.resolve({
      hash: transaction.hash ?? receipt.hash,
      wait: vi.fn().mockResolvedValue({
        ...receipt,
        hash: transaction.hash ?? receipt.hash,
      }),
    });
  });
  provider = providerFixture(broadcastSpy);
  reader = readerFixture();
  token = {
    balanceOf: vi.fn((address: string) => Promise.resolve(
      address === userWallet.address ? amount : parseEther("3.2"))),
  };
  plan = {
    authorization,
    blockers: [],
    campaign: {
      active: true,
      budget: parseEther("3"),
      claimInterval: 3_600n,
      distributed: 0n,
      endTime: 4_000n,
      exists: true,
      maxRewardAmount: amount,
      startTime: 100n,
    },
    claimantState: {
      claimIntervalElapsed: true,
      lastClaimAt: 0n,
      nextClaimAt: 0n,
      rewardNonce: 7n,
    },
    currentEthereumTxNonce: 42,
    estimatedFeeWei: 360_000_000_000_000n,
    estimatedGas: 100_000n,
    expectedAction: "SIGN_AND_BROADCAST",
    gasLimit: 120_000n,
    gasPriceWei: 3_000_000_000n,
    irbBalance: 0n,
    latestBlockTimestamp: 2_000n,
    recoveredApprover: approverWallet.address,
    rewardContractIrbBalance: parseEther("3.3"),
    transaction: {
      chainId: 97,
      data: "0x12345678",
      from: userWallet.address,
      gasLimit: 120_000n,
      gasPrice: 3_000_000_000n,
      nonce: 42,
      to: AURIX_REWARD_CONTRACT_ADDRESS,
      type: 0,
      value: 0n,
    },
    transactionsSent: 0,
    userGasBalanceWei: parseEther("0.01"),
    walletAddress: userWallet.address,
  };
});

function execute(enabled = true) {
  return executeClaim({
    authorization,
    broadcastProviders: [provider],
    encryption: { key: encryptionKey, version: 1 },
    executionEnabled: enabled,
    plan,
    reader,
    repository,
    rewardContractAddress: AURIX_REWARD_CONTRACT_ADDRESS,
    token,
    wallet: walletRecord,
  });
}

describe("claim signing and execution lifecycle", () => {
  it("refuses execution before wallet decryption or broadcast when the guard is false", async () => {
    await expect(execute(false)).rejects.toMatchObject({
      code: "CLAIM_EXECUTION_DISABLED",
      message: "Claim execution is disabled by the execution guard",
    });
    expect(provider.broadcastSpy).not.toHaveBeenCalled();
    expect(repository.signed).toHaveLength(0);
  });

  it("decrypts the encrypted User Wallet and rejects a claimant address mismatch", async () => {
    const other = new Wallet(`0x${"66".repeat(32)}`);
    await expect(executeClaim({
      authorization: { ...authorization, claimant: other.address },
      broadcastProviders: [provider],
      encryption: { key: encryptionKey, version: 1 },
      executionEnabled: true,
      plan,
      reader,
      repository,
      rewardContractAddress: AURIX_REWARD_CONTRACT_ADDRESS,
      token,
      wallet: walletRecord,
    })).rejects.toMatchObject({ code: "CLAIM_WALLET_INVALID" });
    expect(provider.broadcastSpy).not.toHaveBeenCalled();
  });

  it("reports a safe signing failure code without broadcasting", async () => {
    plan = {
      ...plan,
      transaction: { ...plan.transaction, from: approverWallet.address },
    };
    await expect(execute()).rejects.toMatchObject({
      code: "CLAIM_SIGNING_FAILED",
      message: "Claimant transaction signing failed",
    });
    expect(repository.signed).toHaveLength(0);
    expect(provider.broadcastSpy).not.toHaveBeenCalled();
  });

  it("reports the encryption version mismatch with a safe code", async () => {
    walletRecord = { ...walletRecord, encryptionKeyVersion: 2 };
    await expect(execute()).rejects.toMatchObject({
      code: "CLAIM_ENCRYPTION_VERSION_MISMATCH",
    });
    expect(repository.signed).toHaveLength(0);
    expect(provider.broadcastSpy).not.toHaveBeenCalled();
  });

  it("wraps insertSigned driver details in a safe persistence code", async () => {
    const sensitiveDriverMessage = [
      "INSERT INTO reward_claim_jobs",
      userWallet.privateKey,
      walletRecord.encryptedPrivateKey,
      walletRecord.encryptionIv,
      walletRecord.encryptionAuthTag,
      encryptionKey.toString("base64"),
    ].join("|");
    repository.insertError = new Error(sensitiveDriverMessage);
    let caught: unknown;
    try {
      await execute();
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ClaimExecutionError);
    expect(caught).toMatchObject({
      code: "CLAIM_SIGNED_PERSIST_FAILED",
      message: "Signed claim evidence could not be persisted",
    });
    const safeOutput = JSON.stringify(caught);
    for (const secret of [
      sensitiveDriverMessage,
      userWallet.privateKey,
      walletRecord.encryptedPrivateKey,
      walletRecord.encryptionIv,
      walletRecord.encryptionAuthTag,
      encryptionKey.toString("base64"),
    ]) {
      expect(safeOutput).not.toContain(secret);
    }
    expect(provider.broadcastSpy).not.toHaveBeenCalled();
  });

  it("preserves safe stage-level persistence errors without broadcasting", async () => {
    repository.insertError = new ClaimPersistenceError("INSERT_SIGNED_JOB", {
      safeDbCode: "ER_NO_REFERENCED_ROW_2",
      safeDbErrno: 1452,
      safeDbSqlState: "23000",
    });

    await expect(execute()).rejects.toMatchObject({
      code: "CLAIM_PERSIST_INSERT_FAILED",
      safeDbCode: "ER_NO_REFERENCED_ROW_2",
      stage: "INSERT_SIGNED_JOB",
      type: "ClaimPersistenceError",
    });
    expect(provider.broadcastSpy).not.toHaveBeenCalled();
  });

  it("persists the signed hash before broadcast and uses the User Wallet as sender", async () => {
    const result = await execute();
    expect(repository.events[0]).toBe("SIGNED");
    expect(repository.events[1]).toBe(`RPC:${userWallet.address}`);
    expect(repository.signed[0]?.txNonce).toBe(42);
    expect(repository.signed[0]?.rewardNonce).toBe(7n);
    expect(userWallet.address).not.toBe(approverWallet.address);
    expect(result).toMatchObject({ status: "CONFIRMED", transactionsSent: 1 });
    expect(repository.consumedAuthorization).toBe(authorization.jobId);
  });

  it("keeps an RPC receipt timeout unresolved without signing a replacement", async () => {
    const timeoutBroadcast = vi.fn((raw: string) => {
      const transaction = Transaction.from(raw);
      return Promise.resolve({
        hash: transaction.hash ?? receipt.hash,
        wait: vi.fn().mockRejectedValue(new Error("timeout")),
      });
    });
    provider = providerFixture(timeoutBroadcast);
    const result = await execute();
    expect(result.status).toBe("PENDING_REVIEW");
    expect(repository.status).toBe("PENDING_REVIEW");
    expect(repository.signed).toHaveLength(1);
    expect(repository.consumedAuthorization).toBeUndefined();
  });

  it("preserves a broadcast timeout as PENDING_REVIEW with the signed hash", async () => {
    provider.broadcastSpy.mockRejectedValue(new Error("timeout"));
    const result = await execute();
    expect(result).toMatchObject({ status: "PENDING_REVIEW", transactionsSent: 0 });
    expect(result.txHash).toBe(repository.signed[0]?.signedTxHash);
  });

  it("marks a reverted receipt FAILED without consuming the authorization", async () => {
    receipt = { ...receipt, status: 0 };
    const result = await execute();
    expect(result.status).toBe("FAILED");
    expect(repository.status).toBe("FAILED");
    expect(repository.consumedAuthorization).toBeUndefined();
  });

  it("leaves authorization unconsumed when exact event validation fails", async () => {
    receipt = { ...receipt, logs: [] };
    const result = await execute();
    expect(result.status).toBe("PENDING_REVIEW");
    expect(repository.consumedAuthorization).toBeUndefined();
  });

  it("reconciles on-chain reward consumption without resending", async () => {
    provider.broadcastSpy.mockRejectedValue(new Error("timeout"));
    await execute();
    provider.broadcastSpy.mockClear();
    const authorizationRepository: AuthorizationRepository = {
      findByJobId: vi.fn().mockResolvedValue(authorization),
      reservePlanned: vi.fn(),
      markFailed: vi.fn(),
      markReady: vi.fn(),
    };
    const result = await reconcileClaimJobs({
      authorizationRepository,
      providers: [provider],
      reader,
      repository,
      rewardContractAddress: AURIX_REWARD_CONTRACT_ADDRESS,
      token,
    });
    expect(result).toEqual({ inspected: 1, updated: 1 });
    expect(repository.status).toBe("PENDING_REVIEW");
    expect(provider.broadcastSpy).not.toHaveBeenCalled();
  });
});

class FakeClaimRepository implements ClaimRepository {
  public readonly events: string[] = [];
  public readonly signed: SignedClaimJobInput[] = [];
  public consumedAuthorization?: string;
  public insertError?: Error;
  public status = "NONE";

  public findByAuthorizationJobId(): Promise<ClaimJobRecord | undefined> {
    const input = this.signed[0];
    if (!input) return Promise.resolve(undefined);
    return Promise.resolve({ ...input, status: "BROADCAST" });
  }
  public findByRewardId(): Promise<ClaimJobRecord | undefined> { return Promise.resolve(undefined); }
  public insertSigned(input: SignedClaimJobInput): Promise<void> {
    if (this.insertError) return Promise.reject(this.insertError);
    this.events.push("SIGNED");
    this.signed.push(input);
    this.status = "SIGNED";
    return Promise.resolve();
  }
  public listUnresolved(): Promise<readonly ClaimJobRecord[]> {
    return this.findByAuthorizationJobId().then((job) => job ? [job] : []);
  }
  public markBroadcast(): Promise<void> {
    this.status = "BROADCAST";
    return Promise.resolve();
  }
  public markConfirmed(
    _jobId: string,
    authorizationJobId: string,
    inputEvidence: ConfirmedClaimInput,
  ): Promise<void> {
    void inputEvidence;
    this.status = "CONFIRMED";
    this.consumedAuthorization = authorizationJobId;
    return Promise.resolve();
  }
  public markFailed(): Promise<void> {
    this.status = "FAILED";
    return Promise.resolve();
  }
  public markPendingReview(): Promise<void> {
    this.status = "PENDING_REVIEW";
    return Promise.resolve();
  }
}

function providerFixture(broadcastSpy: ReturnType<typeof vi.fn>): ClaimProvider & {
  readonly broadcastSpy: ReturnType<typeof vi.fn>;
} {
  return {
    broadcastSpy,
    broadcastTransaction: broadcastSpy,
    estimateGas: vi.fn(),
    getBalance: vi.fn(),
    getBlock: vi.fn(),
    getCode: vi.fn(),
    getFeeData: vi.fn(),
    getNetwork: vi.fn(),
    getTransaction: vi.fn().mockResolvedValue(null),
    getTransactionCount: vi.fn(),
    getTransactionReceipt: vi.fn().mockResolvedValue(null),
  };
}

function readerFixture(): ClaimChainReader {
  return {
    getCampaign: vi.fn().mockResolvedValue({
      active: true, budget: parseEther("3"), claimInterval: 3_600n,
      distributed: amount, endTime: 4_000n, exists: true,
      maxRewardAmount: amount, startTime: 100n,
    }),
    getClaimantState: vi.fn().mockResolvedValue({
      claimIntervalElapsed: false, lastClaimAt: 2_100n,
      nextClaimAt: 5_700n, rewardNonce: 8n,
    }),
    getRewardToken: vi.fn(),
    hasApproverRole: vi.fn(),
    isPaused: vi.fn(),
    isRewardIdUsed: vi.fn().mockResolvedValue(true),
  };
}
