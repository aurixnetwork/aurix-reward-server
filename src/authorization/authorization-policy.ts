import { parseUnits } from "ethers";

const IRB_AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/;

export function parseIrbAmount(value: string): bigint {
  if (!IRB_AMOUNT_PATTERN.test(value)) {
    throw new Error("IRB amount must be a decimal with at most 18 fractional digits");
  }
  const amount = parseUnits(value, 18);
  if (amount <= 0n) throw new Error("IRB amount must be greater than zero");
  return amount;
}

export function createAuthorizationWindow(
  nowSeconds: number,
  validitySeconds: number,
): { readonly deadline: bigint; readonly validAfter: bigint } {
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) {
    throw new Error("Current time must be non-negative Unix seconds");
  }
  if (!Number.isSafeInteger(validitySeconds) || validitySeconds <= 0) {
    throw new Error("Authorization validity must be positive integer seconds");
  }
  const validAfter = BigInt(nowSeconds);
  const deadline = validAfter + BigInt(validitySeconds);
  if (deadline <= validAfter) throw new Error("Invalid authorization time window");
  return { deadline, validAfter };
}
