import { parseEther, Wallet } from "ethers";
import { describe, expect, it, vi } from "vitest";

import {
  assertFundingWalletSeparated,
  calculateFundingAmount,
  createFundingPlan,
} from "../src/funding/funding-plan.js";
import type { FundingRepository } from "../src/funding/funding-repository.js";
import type { FundingProvider, FundingWalletTarget } from "../src/funding/funding-types.js";

const fundingAddress = new Wallet(`0x${"99".repeat(32)}`).address;

function wallets(): FundingWalletTarget[] {
  return Array.from({ length: 10 }, (_, index) => ({
    id: String(index + 1),
    walletAddress: new Wallet(`0x${(index + 1).toString(16).padStart(64, "0")}`).address,
  }));
}

function repository(active: readonly unknown[] = []): FundingRepository {
  return {
    findActiveByWalletAddresses: vi.fn().mockResolvedValue(active),
  } as unknown as FundingRepository;
}

function provider(balances: Map<string, bigint>, fundingBalance = parseEther("1")) {
  return {
    estimateGas: vi.fn().mockResolvedValue(21_000n),
    getBalance: vi.fn((address: string) =>
      Promise.resolve(address === fundingAddress ? fundingBalance : (balances.get(address) ?? 0n))),
    getFeeData: vi.fn().mockResolvedValue({ gasPrice: 3_000_000_000n }),
    getNetwork: vi.fn().mockResolvedValue({ chainId: 97n }),
  } as unknown as FundingProvider;
}

describe("Funding Wallet target plan", () => {
  it("calculates only the exact missing amount below target", () => {
    expect(calculateFundingAmount(parseEther("0.03"), parseEther("0.05"))).toBe(
      parseEther("0.02"),
    );
  });

  it.each(["0.05", "0.06"])("skips a wallet at or above target (%s)", (balance) => {
    expect(calculateFundingAmount(parseEther(balance), parseEther("0.05"))).toBe(0n);
  });

  it("rejects Funding Wallet and User Wallet address collision", () => {
    expect(() => assertFundingWalletSeparated(fundingAddress, [
      { id: "1", walletAddress: fundingAddress },
    ])).toThrow("matches an ACTIVE test User Wallet");
  });

  it("creates a read-only ten-wallet plan and sends zero transactions", async () => {
    const targets = wallets();
    const balances = new Map(targets.map((wallet) => [wallet.walletAddress, parseEther("0.04")]));
    const rpc = provider(balances);
    const plan = await createFundingPlan({
      fundingWalletAddress: fundingAddress,
      maxGasPriceWei: 5_000_000_000n,
      provider: rpc,
      repository: repository(),
      targetBalanceWei: parseEther("0.05"),
      wallets: targets,
    });
    expect(plan.totalTopUpRequiredWei).toBe(parseEther("0.1"));
    expect(plan.transactionsPlanned).toBe(10);
    expect(plan.transactionsSent).toBe(0);
    expect("broadcastTransaction" in rpc).toBe(false);
  });

  it("classifies an unresolved job without blocking historical future top-ups", async () => {
    const targets = wallets();
    const activeJob = {
      balanceBeforeWei: 0n,
      fundingAmountWei: 1n,
      id: targets[0]?.id ?? "1",
      jobId: "active",
      status: "SIGNED",
      walletAddress: targets[0]?.walletAddress ?? fundingAddress,
    } as const;
    const plan = await createFundingPlan({
      fundingWalletAddress: fundingAddress,
      maxGasPriceWei: undefined,
      provider: provider(new Map()),
      repository: repository([activeJob]),
      targetBalanceWei: 1n,
      wallets: targets,
    });
    expect(plan.wallets[0]?.action).toBe("SKIP_ACTIVE_JOB");
    expect(plan.wallets.slice(1).every((item) => item.action === "FUND")).toBe(true);
  });

  it("reports insufficient Funding Wallet balance for the whole batch", async () => {
    const targets = wallets();
    const plan = await createFundingPlan({
      fundingWalletAddress: fundingAddress,
      maxGasPriceWei: undefined,
      provider: provider(new Map(), 1n),
      repository: repository(),
      targetBalanceWei: parseEther("0.01"),
      wallets: targets,
    });
    expect(plan.sufficientFundingBalance).toBe(false);
  });

  it("reports gas prices above the configured maximum", async () => {
    const targets = wallets();
    const plan = await createFundingPlan({
      fundingWalletAddress: fundingAddress,
      maxGasPriceWei: 1_000_000_000n,
      provider: provider(new Map()),
      repository: repository(),
      targetBalanceWei: 1n,
      wallets: targets,
    });
    expect(plan.gasPriceWithinMaximum).toBe(false);
  });
});
