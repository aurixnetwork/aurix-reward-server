import {
  getAddress,
  isHexString,
  MaxUint256,
  TypedDataEncoder,
  verifyTypedData,
  Wallet,
  type TypedDataDomain,
  type TypedDataField,
} from "ethers";

import {
  AURIX_REWARD_CONTRACT_ADDRESS,
  BSC_TESTNET_CHAIN_ID,
  REWARD_EIP712_NAME,
  REWARD_EIP712_VERSION,
} from "../config/constants.js";
import type { REWARD_AUTHORIZATION_PRIMARY_TYPE } from "../config/constants.js";
import type { RewardAuthorization } from "./authorization-types.js";

export const REWARD_AUTHORIZATION_DOMAIN: Readonly<TypedDataDomain> = {
  chainId: BSC_TESTNET_CHAIN_ID,
  name: REWARD_EIP712_NAME,
  verifyingContract: AURIX_REWARD_CONTRACT_ADDRESS,
  version: REWARD_EIP712_VERSION,
};

export function createRewardAuthorizationDomain(
  chainId: number,
  verifyingContract: string,
): Readonly<TypedDataDomain> {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("EIP-712 chainId must be a positive safe integer");
  }
  return {
    chainId,
    name: REWARD_EIP712_NAME,
    verifyingContract: getAddress(verifyingContract),
    version: REWARD_EIP712_VERSION,
  };
}

export const REWARD_AUTHORIZATION_TYPES: Record<
  typeof REWARD_AUTHORIZATION_PRIMARY_TYPE,
  TypedDataField[]
> = {
  RewardAuthorization: [
    { name: "claimant", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "campaignId", type: "bytes32" },
    { name: "rewardId", type: "bytes32" },
    { name: "rewardNonce", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

export function validateRewardAuthorization(
  authorization: RewardAuthorization,
  nowSeconds?: bigint,
): void {
  getAddress(authorization.claimant);
  assertUint256(authorization.amount, "amount", false);
  assertBytes32(authorization.campaignId, "campaignId");
  assertBytes32(authorization.rewardId, "rewardId");
  assertUint256(authorization.rewardNonce, "rewardNonce", true);
  assertUint256(authorization.validAfter, "validAfter", true);
  assertUint256(authorization.deadline, "deadline", false);
  if (authorization.deadline <= authorization.validAfter) {
    throw new Error("Authorization deadline must be greater than validAfter");
  }
  if (nowSeconds !== undefined) {
    if (authorization.validAfter > nowSeconds) {
      throw new Error("Authorization validAfter is in the future");
    }
    if (authorization.deadline <= nowSeconds) {
      throw new Error("Authorization is expired");
    }
  }
}

export function hashRewardAuthorization(
  authorization: RewardAuthorization,
  domain: TypedDataDomain = REWARD_AUTHORIZATION_DOMAIN,
): string {
  validateRewardAuthorization(authorization);
  return TypedDataEncoder.hash(
    domain,
    REWARD_AUTHORIZATION_TYPES,
    authorization,
  );
}

export async function signRewardAuthorization(
  authorization: RewardAuthorization,
  privateKey: string,
  domain: TypedDataDomain = REWARD_AUTHORIZATION_DOMAIN,
): Promise<string> {
  validateRewardAuthorization(authorization);
  return new Wallet(privateKey).signTypedData(
    domain,
    REWARD_AUTHORIZATION_TYPES,
    authorization,
  );
}

export function recoverRewardAuthorizationSigner(
  authorization: RewardAuthorization,
  signature: string,
  domain: TypedDataDomain = REWARD_AUTHORIZATION_DOMAIN,
): string {
  validateRewardAuthorization(authorization);
  return getAddress(verifyTypedData(
    domain,
    REWARD_AUTHORIZATION_TYPES,
    authorization,
    signature,
  ));
}

function assertBytes32(value: string, field: string): void {
  if (!isHexString(value, 32)) throw new Error(`${field} must be bytes32`);
}

function assertUint256(value: bigint, field: string, allowZero: boolean): void {
  if (value < 0n || value > MaxUint256 || (!allowZero && value === 0n)) {
    throw new Error(`${field} must be a valid ${allowZero ? "non-negative" : "positive"} uint256`);
  }
}
