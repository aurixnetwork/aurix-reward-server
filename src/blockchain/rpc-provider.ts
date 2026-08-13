import { FetchRequest, JsonRpcProvider } from "ethers";

import type { AppConfig } from "../config/environment.js";

export type RpcEndpointLabel = "primary" | "secondary";

export interface ReadOnlyRpcProvider {
  destroy?: () => void;
  getBlockNumber: () => Promise<number>;
  getNetwork: () => Promise<{ chainId: bigint }>;
}

export interface RpcEndpoint {
  readonly label: RpcEndpointLabel;
  readonly provider: ReadOnlyRpcProvider;
}

export interface RpcProbeResult {
  readonly blockNumber?: number;
  readonly chainId?: number;
  readonly healthy: boolean;
  readonly label: RpcEndpointLabel;
  readonly reason?: "request_failed" | "unexpected_chain_id";
}

export interface ConnectedRpc {
  readonly endpoint: RpcEndpoint;
  readonly probes: readonly RpcProbeResult[];
}

export class RpcUnavailableError extends Error {
  public constructor() {
    super("No configured RPC endpoint is healthy on BSC Testnet chain ID 97");
    this.name = "RpcUnavailableError";
  }
}

export class RpcProviderPool {
  public constructor(
    private readonly endpoints: readonly RpcEndpoint[],
    private readonly expectedChainId: number,
  ) {}

  public async connect(): Promise<ConnectedRpc> {
    const probes = await probeRpcEndpoints(this.endpoints, this.expectedChainId);
    const endpoint = this.endpoints.find((candidate) =>
      probes.some((probe) => probe.label === candidate.label && probe.healthy),
    );

    if (!endpoint) {
      throw new RpcUnavailableError();
    }

    return { endpoint, probes };
  }

  public destroy(): void {
    for (const endpoint of this.endpoints) {
      endpoint.provider.destroy?.();
    }
  }
}

export function createRpcProviderPool(config: AppConfig): RpcProviderPool {
  const endpoints: RpcEndpoint[] = [
    {
      label: "primary",
      provider: createJsonRpcProvider(config.rpc.primaryUrl, config.rpc.timeoutMs),
    },
  ];

  if (config.rpc.secondaryUrl) {
    endpoints.push({
      label: "secondary",
      provider: createJsonRpcProvider(config.rpc.secondaryUrl, config.rpc.timeoutMs),
    });
  }

  return new RpcProviderPool(endpoints, config.rpc.expectedChainId);
}

function createJsonRpcProvider(url: string, timeoutMs: number): JsonRpcProvider {
  const request = new FetchRequest(url);
  request.timeout = timeoutMs;
  return new JsonRpcProvider(request);
}

export async function probeRpcEndpoints(
  endpoints: readonly RpcEndpoint[],
  expectedChainId: number,
): Promise<readonly RpcProbeResult[]> {
  return Promise.all(
    endpoints.map(async (endpoint): Promise<RpcProbeResult> => {
      try {
        const network = await endpoint.provider.getNetwork();
        const chainId = Number(network.chainId);
        if (chainId !== expectedChainId) {
          return {
            chainId,
            healthy: false,
            label: endpoint.label,
            reason: "unexpected_chain_id",
          };
        }

        const blockNumber = await endpoint.provider.getBlockNumber();
        return {
          blockNumber,
          chainId,
          healthy: true,
          label: endpoint.label,
        };
      } catch {
        return {
          healthy: false,
          label: endpoint.label,
          reason: "request_failed",
        };
      }
    }),
  );
}
