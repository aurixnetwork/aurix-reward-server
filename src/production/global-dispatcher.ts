import type { CampaignPolicy, Lease, RewardRun, RewardRunItem, WalletExecutionResult } from "./production-types.js";
import { evaluateCampaignPolicy, type RewardHistoryReader } from "./reward-policy.js";
import { formatFinalRunSummary, formatWalletResult } from "./run-output.js";

export interface DispatcherRepository extends RewardHistoryReader {
  acquireDispatcherLease(ownerId: string, now: Date, leaseSeconds: number): Promise<Lease | undefined>;
  releaseDispatcherLease(lease: Lease): Promise<void>;
  acquireWalletLease(item: RewardRunItem, ownerId: string, now: Date, leaseSeconds: number): Promise<Lease | undefined>;
  releaseWalletLease(item: RewardRunItem, lease: Lease): Promise<void>;
  findRecoveryItem(now: Date): Promise<RewardRunItem | undefined>;
  findOldestDueItem(now: Date): Promise<RewardRunItem | undefined>;
  markItemAcquired(item: RewardRunItem, now: Date): Promise<boolean>;
  finalizeItem(item: RewardRunItem, result: WalletExecutionResult, completedAt: Date): Promise<{ readonly processed: number; readonly target: number }>;
  findRun(runId: string): Promise<RewardRun | undefined>;
}

export interface ProductionClaimExecutor {
  execute(item: RewardRunItem): Promise<WalletExecutionResult>;
  reconcile(item: RewardRunItem): Promise<WalletExecutionResult>;
}

export interface DispatcherDependencies {
  readonly ownerId: string;
  readonly repository: DispatcherRepository;
  readonly executor: ProductionClaimExecutor;
  readonly dispatcherLeaseSeconds: number;
  readonly walletLeaseSeconds: number;
  readonly clock?: () => Date;
  readonly output?: (line: string) => void;
}

export async function dispatchOne(dependencies: DispatcherDependencies): Promise<
  { readonly status: "IDLE" | "DISPATCHED" | "LEASE_BUSY" | "WALLET_BUSY"; readonly result?: WalletExecutionResult }
> {
  const now = dependencies.clock?.() ?? new Date();
  const globalLease = await dependencies.repository.acquireDispatcherLease(
    dependencies.ownerId, now, dependencies.dispatcherLeaseSeconds,
  );
  if (!globalLease) return { status: "LEASE_BUSY" };
  try {
    const recovery = await dependencies.repository.findRecoveryItem(now);
    const item = recovery ?? await dependencies.repository.findOldestDueItem(now);
    if (!item) return { status: "IDLE" };
    const walletLease = await dependencies.repository.acquireWalletLease(
      item, dependencies.ownerId, now, dependencies.walletLeaseSeconds,
    );
    if (!walletLease) return { status: "WALLET_BUSY" };
    try {
      if (!recovery && !await dependencies.repository.markItemAcquired(item, now)) {
        return { status: "LEASE_BUSY" };
      }
      let result: WalletExecutionResult;
      try {
        result = recovery
          ? await dependencies.executor.reconcile(item)
          : await executeWithPolicy(item, dependencies.repository, dependencies.executor);
      } catch {
        result = {
          action: "SYSTEM_ERROR",
          classification: "SYSTEM_ERROR",
          errorCode: "DISPATCH_SYSTEM_ERROR",
          transactionsSent: 0,
        };
      }
      const completedAt = dependencies.clock?.() ?? new Date();
      const progress = await dependencies.repository.finalizeItem(item, result, completedAt);
      const output = dependencies.output ?? console.log;
      output(formatWalletResult(item, result, progress.processed, progress.target, completedAt));
      if (progress.processed >= progress.target) {
        const run = await dependencies.repository.findRun(item.runId);
        if (run) output(formatFinalRunSummary(run));
      }
      return { result, status: "DISPATCHED" };
    } finally {
      await dependencies.repository.releaseWalletLease(item, walletLease);
    }
  } finally {
    await dependencies.repository.releaseDispatcherLease(globalLease);
  }
}

async function executeWithPolicy(
  item: RewardRunItem,
  history: RewardHistoryReader,
  executor: ProductionClaimExecutor,
): Promise<WalletExecutionResult> {
  const decision = await evaluateCampaignPolicy({
    campaignId: item.campaignId,
    chainId: item.chainId,
    claimant: item.claimant,
    history,
    policy: item.policy,
    policyScope: item.policyScope,
  });
  if (decision.action === "ELIGIBLE") return executor.execute(item);
  if (decision.action === "RECONCILIATION_REQUIRED") {
    return { action: decision.action, classification: "RECONCILIATION_REQUIRED", transactionsSent: 0 };
  }
  return { action: decision.action, classification: "SKIPPED", transactionsSent: 0 };
}

export function selectOldestDueCampaign<T extends { readonly id: string; readonly nextDispatchAt?: Date }>(
  campaigns: readonly T[], now: Date,
): T | undefined {
  return [...campaigns]
    .filter((campaign) => !campaign.nextDispatchAt || campaign.nextDispatchAt <= now)
    .sort((left: T, right: T) => {
      const time = (left.nextDispatchAt?.getTime() ?? 0) - (right.nextDispatchAt?.getTime() ?? 0);
      return time === 0 ? left.id.localeCompare(right.id) : time;
    })[0];
}

export function policyAllowsConcurrentRewardNonce(
  left: { readonly campaignId: string; readonly claimant: string },
  right: { readonly campaignId: string; readonly claimant: string },
): boolean {
  return left.campaignId !== right.campaignId || left.claimant !== right.claimant;
}

export function ethereumNonceRequiresWalletLease(
  left: { readonly claimant: string }, right: { readonly claimant: string },
): boolean {
  return left.claimant.toLowerCase() === right.claimant.toLowerCase();
}

export function isPolicy(value: string): value is CampaignPolicy {
  return ["FIRST_REWARD_ONLY", "ONCE_PER_CAMPAIGN", "RECURRING"].includes(value);
}
