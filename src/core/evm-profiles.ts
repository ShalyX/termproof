import type { EvmNetwork } from './types.ts';

export interface EvmChainProfile {
  key: EvmNetwork;
  family: 'evm';
  chainId: string;
  rpcEnvironmentVariable: string;
  defaultRpcUrl: string;
  explorerUrl: string;
  usdcErc20Address?: string;
  cctpDomain?: number;
}

/** Allowlisted EVM profiles. Names are protocol metadata, never verdict selectors. */
export const EVM_CHAIN_PROFILES: Record<EvmNetwork, EvmChainProfile> = {
  base: {
    key: 'base',
    family: 'evm',
    chainId: '0x2105',
    rpcEnvironmentVariable: 'BASE_RPC_URL',
    defaultRpcUrl: 'https://mainnet.base.org',
    explorerUrl: 'https://basescan.org',
  },
  'base-sepolia': {
    key: 'base-sepolia',
    family: 'evm',
    chainId: '0x14a34',
    rpcEnvironmentVariable: 'BASE_SEPOLIA_RPC_URL',
    defaultRpcUrl: 'https://sepolia.base.org',
    explorerUrl: 'https://sepolia.basescan.org',
  },
  'arc-testnet': {
    key: 'arc-testnet',
    family: 'evm',
    chainId: '0x4cef52',
    rpcEnvironmentVariable: 'ARC_TESTNET_RPC_URL',
    defaultRpcUrl: 'https://rpc.testnet.arc.network',
    explorerUrl: 'https://testnet.arcscan.app',
    usdcErc20Address: '0x3600000000000000000000000000000000000000',
    cctpDomain: 26,
  },
};

export function getEvmProfileKeys(): EvmNetwork[] {
  return Object.keys(EVM_CHAIN_PROFILES) as EvmNetwork[];
}

export function getEvmChainProfile(network: string): EvmChainProfile {
  const profile = (EVM_CHAIN_PROFILES as Record<string, EvmChainProfile>)[network];
  if (!profile) throw new Error(`Unsupported or unallowlisted EVM chain profile: ${network}`);
  return profile;
}
