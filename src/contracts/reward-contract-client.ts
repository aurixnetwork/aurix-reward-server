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

export interface RewardCampaign {
  readonly active: boolean;
  readonly budget: bigint;
  readonly claimInterval: bigint;
  readonly distributed: bigint;
  readonly endTime: bigint;
  readonly exists: boolean;
  readonly maxRewardAmount: bigint;
  readonly startTime: bigint;
}

export interface RewardClaimantState {
  readonly claimIntervalElapsed: boolean;
  readonly lastClaimAt: bigint;
  readonly nextClaimAt: bigint;
  readonly rewardNonce: bigint;
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

  public async getCampaign(campaignId: string): Promise<RewardCampaign> {
    const campaign = (await this.contract.getFunction("campaigns")(
      campaignId,
    )) as readonly [bigint, bigint, bigint, bigint, bigint, bigint, boolean, boolean];
    return {
      active: campaign[6],
      budget: campaign[0],
      claimInterval: campaign[5],
      distributed: campaign[1],
      endTime: campaign[4],
      exists: campaign[7],
      maxRewardAmount: campaign[2],
      startTime: campaign[3],
    };
  }

  public async getClaimantState(
    campaignId: string,
    claimant: string,
  ): Promise<RewardClaimantState> {
    const normalizedClaimant = getAddress(claimant);
    const [rewardNonce, lastClaimAt, nextClaimAt, claimIntervalElapsed] =
      await Promise.all([
        this.contract.getFunction("getRewardNonce")(campaignId, normalizedClaimant) as Promise<bigint>,
        this.contract.getFunction("getLastClaimAt")(campaignId, normalizedClaimant) as Promise<bigint>,
        this.contract.getFunction("getNextClaimAt")(campaignId, normalizedClaimant) as Promise<bigint>,
        this.contract.getFunction("isClaimIntervalElapsed")(
          campaignId,
          normalizedClaimant,
        ) as Promise<boolean>,
      ]);
    return { claimIntervalElapsed, lastClaimAt, nextClaimAt, rewardNonce };
  }

  public async getRewardNonce(
    campaignId: string,
    claimant: string,
  ): Promise<bigint> {
    return this.contract.getFunction("getRewardNonce")(
      campaignId,
      getAddress(claimant),
    ) as Promise<bigint>;
  }

  public async isRewardIdUsed(rewardId: string): Promise<boolean> {
    return this.contract.getFunction("usedRewardIds")(rewardId) as Promise<boolean>;
  }

  public async getAuthorizationTypeHash(): Promise<string> {
    return this.contract.getFunction("REWARD_AUTHORIZATION_TYPEHASH")() as Promise<string>;
  }

  public async hasApproverRole(account: string): Promise<boolean> {
    return this.hasRole(await this.getRoleId("APPROVER_ROLE"), account);
  }

  public async isPaused(): Promise<boolean> {
    return this.contract.getFunction("paused")() as Promise<boolean>;
  }

  public async getRoleId(
    role: "APPROVER_ROLE" | "CAMPAIGN_MANAGER_ROLE" | "DEFAULT_ADMIN_ROLE" | "TREASURY_ROLE",
  ): Promise<string> {
    return this.contract.getFunction(role)() as Promise<string>;
  }

  public async hasRole(role: string, account: string): Promise<boolean> {
    return this.contract.getFunction("hasRole")(
      role,
      getAddress(account),
    ) as Promise<boolean>;
  }

  public async getClaimIntervalBounds(): Promise<{
    readonly maximum: bigint;
    readonly minimum: bigint;
  }> {
    const [minimum, maximum] = await Promise.all([
      this.contract.getFunction("MIN_CLAIM_INTERVAL")() as Promise<bigint>,
      this.contract.getFunction("MAX_CLAIM_INTERVAL")() as Promise<bigint>,
    ]);
    return { maximum, minimum };
  }
}
