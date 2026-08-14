import { Wallet } from "ethers";

export interface GeneratedWallet {
  readonly address: string;
  readonly privateKey: string;
}

export function generateWallet(): GeneratedWallet {
  const wallet = Wallet.createRandom();
  return {
    address: wallet.address,
    privateKey: wallet.privateKey,
  };
}
