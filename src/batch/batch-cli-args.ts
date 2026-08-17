import { isHexString } from "ethers";

import { parseIrbAmount } from "../authorization/authorization-policy.js";

import type { BatchCommandArgs } from "./batch-types.js";

const EXPECTED_ARGUMENTS = [
  "campaign-id",
  "wallet-id-start",
  "wallet-id-end",
  "amount",
] as const;

export function parseBatchCommandArgs(args: readonly string[]): BatchCommandArgs {
  if (args.length !== EXPECTED_ARGUMENTS.length * 2) {
    throw new Error(
      "Required arguments: --campaign-id <bytes32> --wallet-id-start <id> --wallet-id-end <id> --amount <IRB>",
    );
  }
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error("Malformed batch command arguments");
    }
    const name = flag.slice(2);
    if (!(EXPECTED_ARGUMENTS as readonly string[]).includes(name) || values.has(name)) {
      throw new Error(`Unexpected or duplicate argument: ${flag}`);
    }
    values.set(name, value);
  }

  const campaignId = values.get("campaign-id");
  if (!campaignId || !isHexString(campaignId, 32)) {
    throw new Error("--campaign-id must be a bytes32 hex value");
  }
  const walletIdStart = parseWalletId(values.get("wallet-id-start"), "--wallet-id-start");
  const walletIdEnd = parseWalletId(values.get("wallet-id-end"), "--wallet-id-end");
  if (walletIdEnd < walletIdStart) {
    throw new Error("--wallet-id-end must be greater than or equal to --wallet-id-start");
  }
  const amount = values.get("amount");
  if (!amount) throw new Error("--amount is required");
  return {
    amount: parseIrbAmount(amount),
    campaignId,
    walletIdEnd,
    walletIdStart,
  };
}

function parseWalletId(value: string | undefined, name: string): number {
  if (!value || !/^\d+$/.test(value)) {
    throw new Error(`${name} must be a positive safe integer database ID`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive safe integer database ID`);
  }
  return parsed;
}
