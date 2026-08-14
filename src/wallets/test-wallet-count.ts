import {
  DEFAULT_TEST_WALLET_COUNT,
  MAX_TEST_WALLET_COUNT,
} from "../config/constants.js";

export function parseTestWalletCount(args: readonly string[]): number {
  if (args.length === 0) {
    return DEFAULT_TEST_WALLET_COUNT;
  }

  let rawCount: string | undefined;
  if (args.length === 2 && args[0] === "--count") {
    rawCount = args[1];
  } else if (args.length === 1 && args[0]?.startsWith("--count=")) {
    rawCount = args[0].slice("--count=".length);
  } else {
    throw new Error("Usage: wallets:create:test -- --count <1-100>");
  }

  if (!rawCount || !/^\d+$/.test(rawCount)) {
    throw new Error("Wallet count must be an integer from 1 to 100");
  }
  const count = Number(rawCount);
  assertTestWalletCount(count);
  return count;
}

export function assertTestWalletCount(count: number): void {
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_TEST_WALLET_COUNT) {
    throw new Error("Wallet count must be an integer from 1 to 100");
  }
}
