import "dotenv/config";

import { formatUnits, parseUnits } from "ethers";

import { loadMainnetEnvironment } from "../config/mainnet-environment.js";
import { createRewardPlan } from "../production/reward-planning.js";
import { runCommand } from "./run-command.js";

function value(flag: string): string {
  const index = process.argv.indexOf(flag);
  const found = index < 0 ? undefined : process.argv[index + 1];
  if (!found) throw new Error(`${flag} is required`);
  return found;
}

await runCommand("mainnet:reward:plan", () => {
  const config = loadMainnetEnvironment();
  const plan = createRewardPlan({
    walletCount: Number(value("--wallet-count")),
    rewardAmountPerWallet: parseUnits(value("--reward-amount"), 18),
    ...(process.argv.includes("--inventory-buffer")
      ? { inventoryBuffer: parseUnits(value("--inventory-buffer"), 18) }
      : {}),
    limits: config.limits,
  });
  return Promise.resolve({
    ...plan,
    rewardAmountPerWallet: formatUnits(plan.rewardAmountPerWallet, 18),
    campaignBudgetRequired: formatUnits(plan.campaignBudgetRequired, 18),
    buffer: formatUnits(plan.buffer, 18),
    rewardContractInventoryRequired: formatUnits(plan.rewardContractInventoryRequired, 18),
    maximumAggregateReward: formatUnits(plan.maximumAggregateReward, 18),
  });
});
