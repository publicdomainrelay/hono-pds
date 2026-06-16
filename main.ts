import { Secp256k1Keypair } from "@atproto/crypto";
import { DenoKvStorage, signerFromKeypair } from "@publicdomainrelay/atproto-repo-deno";
import { createRepoFactory } from "@publicdomainrelay/hono-factory-atproto-repo-deno";
import type { RepoFactory } from "@publicdomainrelay/hono-factory-atproto-repo-deno";

export async function createFromEnv(): Promise<RepoFactory> {
  const keyHex = globalThis.Deno?.env.get("PDS_PRIVATE_KEY_HEX");
  let kp: Secp256k1Keypair;
  if (keyHex) {
    kp = await Secp256k1Keypair.import(keyHex);
  } else {
    kp = await Secp256k1Keypair.create();
    console.error("Generated new keypair. DID:", kp.did());
    // kp.export() not called — Web Crypto keys are non-extractable by default
  }

  const signer = signerFromKeypair(kp);
  const storage = await DenoKvStorage.create();

  const didWebServices: Array<{ id: string; type: string }> = [];
  if (globalThis.Deno?.env.get("PDS_DID_WEB_SERVICES")) {
    try {
      const parsed = JSON.parse(globalThis.Deno.env.get("PDS_DID_WEB_SERVICES")!);
      didWebServices.push(...parsed);
    } catch {
      console.error("Failed to parse PDS_DID_WEB_SERVICES, ignoring");
    }
  }

  return createRepoFactory({
    storage,
    signer,
    didWebServices: didWebServices.length > 0 ? didWebServices : undefined,
  });
}

export interface StartResult {
  app: RepoFactory["app"];
  server: Deno.HttpServer;
  repo: RepoFactory;
  port: number;
}

export async function start(port?: number): Promise<StartResult> {
  const repo = await createFromEnv();
  const p = port ?? parseInt(globalThis.Deno?.env.get("PORT") ?? "2583");
  const server = Deno.serve({ port: p, hostname: "127.0.0.1" }, repo.app.fetch);
  console.error(`PDS listening on :${p}`);
  return { app: repo.app, server, repo, port: p };
}

if (import.meta.main) {
  await start();
}
