export type Network = 'mainnet' | 'testnet';

export type HexString = string;

/** 64 hex characters representing a 32-byte x-only public key. */
export type PublicKeyXOnly = HexString;

/** 64 hex characters representing a 32-byte private key. */
export type PrivateKeyHex = HexString;

/** Bitcoin Pay-to-Taproot address (bc1p... or tb1p..., 62 characters). */
export type P2TRAddress = string;

export interface KeyPair {
  privateKey: PrivateKeyHex;
  publicKey: PublicKeyXOnly;
  address: P2TRAddress;
  network: Network;
}
