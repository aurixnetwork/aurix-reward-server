import { describe, expect, it, vi } from "vitest";

import {
  probeRpcEndpoints,
  RpcProviderPool,
  RpcUnavailableError,
  type ReadOnlyRpcProvider,
  type RpcEndpoint,
} from "../src/blockchain/rpc-provider.js";

function endpoint(
  label: RpcEndpoint["label"],
  chainId: number,
  blockNumber: number,
  fails = false,
): RpcEndpoint {
  const provider: ReadOnlyRpcProvider = {
    destroy: vi.fn(),
    getBlockNumber: fails
      ? vi.fn().mockRejectedValue(new Error("offline"))
      : vi.fn().mockResolvedValue(blockNumber),
    getNetwork: fails
      ? vi.fn().mockRejectedValue(new Error("offline"))
      : vi.fn().mockResolvedValue({ chainId: BigInt(chainId) }),
  };
  return { label, provider };
}

describe("RPC provider failover", () => {
  it("selects the secondary endpoint when the primary is unavailable", async () => {
    const primary = endpoint("primary", 97, 1, true);
    const secondary = endpoint("secondary", 97, 123);
    const pool = new RpcProviderPool([primary, secondary], 97);

    const connected = await pool.connect();

    expect(connected.endpoint.label).toBe("secondary");
    expect(connected.probes).toEqual([
      { healthy: false, label: "primary", reason: "request_failed" },
      { blockNumber: 123, chainId: 97, healthy: true, label: "secondary" },
    ]);
  });

  it("marks an endpoint unhealthy when its chain ID is wrong", async () => {
    const probes = await probeRpcEndpoints([endpoint("primary", 56, 123)], 97);
    expect(probes).toEqual([
      {
        chainId: 56,
        healthy: false,
        label: "primary",
        reason: "unexpected_chain_id",
      },
    ]);
  });

  it("fails when no endpoint is healthy", async () => {
    const pool = new RpcProviderPool([endpoint("primary", 97, 1, true)], 97);
    await expect(pool.connect()).rejects.toBeInstanceOf(RpcUnavailableError);
  });
});
