import { parseEther, Transaction, Wallet } from "ethers";
import { describe, expect, it, vi } from "vitest";

import type { FundingRepository } from "../src/funding/funding-repository.js";
import { executeFundingBatch, reconcileFundingJobs } from "../src/funding/funding-service.js";
import type {
  FundingJobRecord,
  FundingProvider,
  FundingReceipt,
  SignedFundingJobInput,
} from "../src/funding/funding-types.js";

const fundingPrivateKey = `0x${"77".repeat(32)}`;
const fundingAddress = new Wallet(fundingPrivateKey).address;
const target = parseEther("0.05");
const targets = Array.from({ length: 10 }, (_, index) => ({
  id: String(index + 1),
  walletAddress: new Wallet(`0x${(index + 20).toString(16).padStart(64, "0")}`).address,
}));

class FakeFundingRepository implements FundingRepository {
  public readonly events: string[] = [];
  public readonly signed: SignedFundingJobInput[] = [];
  public readonly skipped: string[] = [];
  public readonly states = new Map<string, string>();
  public unresolved: FundingJobRecord[] = [];

  public findActiveByWalletAddresses(): Promise<readonly FundingJobRecord[]> {
    return Promise.resolve([]);
  }
  public insertSigned(input: SignedFundingJobInput): Promise<void> {
    this.events.push(`SIGNED:${input.txNonce}`);
    this.signed.push(input);
    this.states.set(input.jobId, "SIGNED");
    return Promise.resolve();
  }
  public insertSkipped(input: { readonly id: string }): Promise<void> {
    this.skipped.push(input.id);
    return Promise.resolve();
  }
  public listJobs(): Promise<readonly FundingJobRecord[]> { return Promise.resolve([]); }
  public listUnresolved(): Promise<readonly FundingJobRecord[]> { return Promise.resolve(this.unresolved); }
  public markBroadcast(jobId: string): Promise<void> {
    this.events.push("BROADCAST_PERSISTED");
    this.states.set(jobId, "BROADCAST");
    return Promise.resolve();
  }
  public markConfirmed(jobId: string): Promise<void> {
    this.states.set(jobId, "CONFIRMED");
    return Promise.resolve();
  }
  public markFailed(jobId: string): Promise<void> {
    this.states.set(jobId, "FAILED");
    return Promise.resolve();
  }
  public markPendingReview(jobId: string): Promise<void> {
    this.states.set(jobId, "PENDING_REVIEW");
    return Promise.resolve();
  }
}

function createProvider(options: {
  readonly fundingBalance?: bigint;
  readonly onBroadcast?: () => void;
  readonly receiptStatus?: number | null;
  readonly timeout?: boolean;
  readonly walletsBelowTarget?: number;
} = {}): FundingProvider & {
  readonly broadcastSpy: ReturnType<typeof vi.fn>;
  readonly balanceSpy: ReturnType<typeof vi.fn>;
  readonly receiptSpy: ReturnType<typeof vi.fn>;
} {
  const below = options.walletsBelowTarget ?? 1;
  const calls = new Map<string, number>();
  const broadcastTransaction = vi.fn((raw: string) => {
    options.onBroadcast?.();
    const transaction = Transaction.from(raw);
    const hash = transaction.hash ?? `0x${"ef".repeat(32)}`;
    return Promise.resolve({
      hash,
      wait: options.timeout
        ? vi.fn().mockRejectedValue(new Error("timeout"))
        : vi.fn().mockResolvedValue({
            blockNumber: 123,
            gasPrice: 3_000_000_000n,
            gasUsed: 21_000n,
            hash,
            status: options.receiptStatus ?? 1,
          } satisfies FundingReceipt),
    });
  });
  const receiptSpy = vi.fn().mockResolvedValue(null);
  const balanceSpy = vi.fn((address: string) => {
    if (address === fundingAddress) return Promise.resolve(options.fundingBalance ?? parseEther("10"));
    const index = targets.findIndex((wallet) => wallet.walletAddress === address);
    const count = (calls.get(address) ?? 0) + 1;
    calls.set(address, count);
    if (index >= below) return Promise.resolve(target);
    return Promise.resolve(count >= 3 ? target : parseEther("0.01"));
  });
  return {
    balanceSpy,
    broadcastTransaction,
    broadcastSpy: broadcastTransaction,
    estimateGas: vi.fn().mockResolvedValue(21_000n),
    getBalance: balanceSpy,
    getFeeData: vi.fn().mockResolvedValue({ gasPrice: 3_000_000_000n }),
    getNetwork: vi.fn().mockResolvedValue({ chainId: 97n }),
    getTransaction: vi.fn().mockResolvedValue(null),
    getTransactionCount: vi.fn().mockResolvedValue(40),
    getTransactionReceipt: receiptSpy,
    receiptSpy,
  };
}

describe("funding execution lifecycle", () => {
  it("blocks all transaction sending when execution is disabled", async () => {
    const provider = createProvider();
    await expect(executeFundingBatch({
      broadcastProviders: [provider], executionEnabled: false, fundingPrivateKey,
      maxGasPriceWei: undefined, primaryProvider: provider,
      repository: new FakeFundingRepository(), targetBalanceWei: target, wallets: targets,
    })).rejects.toThrow("execution is disabled");
    expect(provider.broadcastSpy).not.toHaveBeenCalled();
  });

  it("aborts an insufficient batch before the first send", async () => {
    const provider = createProvider({ fundingBalance: 1n, walletsBelowTarget: 10 });
    const repository = new FakeFundingRepository();
    await expect(executeFundingBatch({
      broadcastProviders: [provider], executionEnabled: true, fundingPrivateKey,
      maxGasPriceWei: undefined, primaryProvider: provider, repository,
      targetBalanceWei: target, wallets: targets,
    })).rejects.toThrow("complete batch");
    expect(provider.broadcastSpy).not.toHaveBeenCalled();
    expect(repository.signed).toHaveLength(0);
  });

  it("allocates sequential nonces, persists signed hashes before broadcast, and confirms", async () => {
    const repository = new FakeFundingRepository();
    const provider = createProvider({
      onBroadcast: () => repository.events.push("RPC_BROADCAST"),
      walletsBelowTarget: 2,
    });
    const result = await executeFundingBatch({
      broadcastProviders: [provider], executionEnabled: true, fundingPrivateKey,
      maxGasPriceWei: 5_000_000_000n, primaryProvider: provider, repository,
      targetBalanceWei: target, wallets: targets,
    });

    expect(repository.signed.map((job) => job.txNonce)).toEqual([40, 41]);
    expect(repository.signed.every((job) => /^0x[0-9a-f]{64}$/i.test(job.signedTxHash))).toBe(true);
    expect(repository.events.indexOf("SIGNED:40")).toBeLessThan(repository.events.indexOf("RPC_BROADCAST"));
    expect(result).toMatchObject({ confirmed: 2, failed: 0, pendingReview: 0, transactionsSent: 2 });
    expect(repository.skipped).toHaveLength(8);
    expect(
      provider.balanceSpy.mock.calls.filter(([address]) => address === targets[0]?.walletAddress),
    ).toHaveLength(3);
  });

  it("marks a reverted receipt FAILED", async () => {
    const provider = createProvider({ receiptStatus: 0 });
    const repository = new FakeFundingRepository();
    const result = await executeFundingBatch({
      broadcastProviders: [provider], executionEnabled: true, fundingPrivateKey,
      maxGasPriceWei: undefined, primaryProvider: provider, repository,
      targetBalanceWei: target, wallets: targets,
    });
    expect(result.failed).toBe(1);
    expect([...repository.states.values()]).toContain("FAILED");
  });

  it("keeps a receipt timeout unresolved for later reconciliation", async () => {
    const provider = createProvider({ timeout: true });
    const repository = new FakeFundingRepository();
    const result = await executeFundingBatch({
      broadcastProviders: [provider], executionEnabled: true, fundingPrivateKey,
      maxGasPriceWei: undefined, primaryProvider: provider, repository,
      targetBalanceWei: target, wallets: targets,
    });
    expect(result.pendingReview).toBe(1);
    expect([...repository.states.values()]).toContain("PENDING_REVIEW");
  });

  it("reconciles a signed hash that is confirmed after restart", async () => {
    const provider = createProvider();
    const repository = new FakeFundingRepository();
    const job: FundingJobRecord = {
      balanceBeforeWei: 1n, fundingAmountWei: 2n, id: "1", jobId: "job",
      signedTxHash: `0x${"12".repeat(32)}`, status: "SIGNED",
      walletAddress: targets[0]?.walletAddress ?? fundingAddress,
    };
    repository.unresolved = [job];
    provider.receiptSpy.mockResolvedValue({
      blockNumber: 10, gasPrice: 2n, gasUsed: 21_000n,
      hash: job.signedTxHash ?? "", status: 1,
    });
    const result = await reconcileFundingJobs(repository, [provider]);
    expect(result).toEqual({ inspected: 1, updated: 1 });
    expect(repository.states.get("job")).toBe("CONFIRMED");
  });
});
