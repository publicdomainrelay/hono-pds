import { Secp256k1Keypair, verifySignature } from "@atproto/crypto";
import type { Bytes, Did, Signer, Verifier } from "@publicdomainrelay/atproto-repo-abc";

export function signerFromKeypair(kp: Secp256k1Keypair): Signer {
  return {
    did(): Did {
      return kp.did();
    },
    sign(bytes: Bytes): Promise<Bytes> {
      return kp.sign(bytes);
    },
  };
}

export async function signerFromPrivateKeyHex(hex: string): Promise<Signer> {
  const kp = await Secp256k1Keypair.import(hex);
  return signerFromKeypair(kp);
}

export function createVerifier(): Verifier {
  return {
    verify(did: Did, bytes: Bytes, sig: Bytes): Promise<boolean> {
      return verifySignature(did, bytes, sig);
    },
  };
}

export function verifierFromKeypair(_kp: Secp256k1Keypair): Verifier {
  return createVerifier();
}
