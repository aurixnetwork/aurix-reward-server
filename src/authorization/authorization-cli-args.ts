import { isHexString } from "ethers";

import { parseIrbAmount } from "./authorization-policy.js";

export interface AuthorizationCommandArgs {
  readonly amount: bigint;
  readonly campaignId: string;
  readonly walletId: string;
}

export function parseAuthorizationCommandArgs(
  args: readonly string[],
): AuthorizationCommandArgs {
  const values = parseNamedArgs(args, ["wallet-id", "campaign-id", "amount"]);
  const walletId = values.get("wallet-id");
  const campaignId = values.get("campaign-id");
  const amount = values.get("amount");
  if (!walletId || !/^\d+$/.test(walletId) || BigInt(walletId) < 1n) {
    throw new Error("--wallet-id must be a positive database ID");
  }
  assertCampaignId(campaignId);
  if (!amount) throw new Error("--amount is required");
  return { amount: parseIrbAmount(amount), campaignId, walletId };
}

export function parseCampaignInspectArgs(args: readonly string[]): string {
  const campaignId = parseNamedArgs(args, ["campaign-id"]).get("campaign-id");
  assertCampaignId(campaignId);
  return campaignId;
}

export function parseAuthorizationVerifyArgs(args: readonly string[]): string {
  const jobId = parseNamedArgs(args, ["job-id"]).get("job-id");
  if (!jobId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) {
    throw new Error("--job-id must be a UUID");
  }
  return jobId;
}

function parseNamedArgs(
  args: readonly string[],
  expectedNames: readonly string[],
): Map<string, string> {
  if (args.length !== expectedNames.length * 2) {
    throw new Error(`Required arguments: ${expectedNames.map((name) => `--${name} <value>`).join(" ")}`);
  }
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith("--") || !value) throw new Error("Malformed command arguments");
    const name = flag.slice(2);
    if (!expectedNames.includes(name) || values.has(name)) {
      throw new Error(`Unexpected or duplicate argument: ${flag}`);
    }
    values.set(name, value);
  }
  return values;
}

function assertCampaignId(value: string | undefined): asserts value is string {
  if (!value || !isHexString(value, 32)) {
    throw new Error("--campaign-id must be a bytes32 hex value");
  }
}
