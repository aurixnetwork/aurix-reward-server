import { Contract, getAddress, type Provider } from "ethers";

const READ_ONLY_ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function owner() view returns (address)",
] as const;

export interface IrbTokenInspection {
  readonly decimals: number;
  readonly name: string;
  readonly symbol: string;
  readonly totalSupplyBaseUnits: string;
}

export class IrbTokenClient {
  private readonly contract: Contract;

  public constructor(
    provider: Provider,
    public readonly address: string,
  ) {
    this.contract = new Contract(getAddress(address), READ_ONLY_ERC20_ABI, provider);
  }

  public async balanceOf(account: string): Promise<bigint> {
    return this.contract.getFunction("balanceOf")(
      getAddress(account),
    ) as Promise<bigint>;
  }

  public async inspect(): Promise<IrbTokenInspection> {
    const [name, symbol, decimals, totalSupply] = await Promise.all([
      this.contract.getFunction("name")() as Promise<string>,
      this.contract.getFunction("symbol")() as Promise<string>,
      this.contract.getFunction("decimals")() as Promise<bigint>,
      this.contract.getFunction("totalSupply")() as Promise<bigint>,
    ]);

    return {
      decimals: Number(decimals),
      name,
      symbol,
      totalSupplyBaseUnits: totalSupply.toString(),
    };
  }

  public async owner(): Promise<string> {
    return getAddress(await this.contract.getFunction("owner")() as string);
  }
}
