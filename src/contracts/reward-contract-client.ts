import { Contract, getAddress, type Provider } from "ethers";

import rewardContractAbi from "./abi/AurixRewardClaim.json" with { type: "json" };

export interface RewardDomainIdentity {
  readonly chainId: number;
  readonly extensions: readonly string[];
  readonly fields: string;
  readonly name: string;
  readonly salt: string;
  readonly verifyingContract: string;
  readonly version: string;
}

export interface RewardContractInspection {
  readonly domain: RewardDomainIdentity;
  readonly eip712Name: string;
  readonly eip712Version: string;
  readonly paused: boolean;
  readonly rewardToken: string;
}

export class RewardContractClient {
  private readonly contract: Contract;

  public constructor(
    provider: Provider,
    public readonly address: string,
  ) {
    this.contract = new Contract(getAddress(address), rewardContractAbi, provider);
  }

  public async getDomainIdentity(): Promise<RewardDomainIdentity> {
    const domain = (await this.contract.getFunction("eip712Domain")()) as readonly [
      string,
      string,
      string,
      bigint,
      string,
      string,
      readonly bigint[],
    ];

    return {
      chainId: Number(domain[3]),
      extensions: domain[6].map(String),
      fields: domain[0],
      name: domain[1],
      salt: domain[5],
      verifyingContract: getAddress(domain[4]),
      version: domain[2],
    };
  }

  public async inspect(): Promise<RewardContractInspection> {
    const [rewardToken, paused, domain, eip712Name, eip712Version] =
      await Promise.all([
        this.contract.getFunction("rewardToken")() as Promise<string>,
        this.contract.getFunction("paused")() as Promise<boolean>,
        this.getDomainIdentity(),
        this.contract.getFunction("eip712Name")() as Promise<string>,
        this.contract.getFunction("eip712Version")() as Promise<string>,
      ]);

    return {
      domain,
      eip712Name,
      eip712Version,
      paused,
      rewardToken: getAddress(rewardToken),
    };
  }
}
