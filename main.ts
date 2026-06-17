import { Secp256k1Keypair } from "@atproto/crypto";
import { DenoKvStorage, signerFromKeypair } from "@publicdomainrelay/atproto-repo-deno";
import { createRepoFactory } from "@publicdomainrelay/hono-factory-atproto-repo-deno";
import type { RepoFactory } from "@publicdomainrelay/hono-factory-atproto-repo-deno";
import { rawStructuredLogger, type Logger } from "@publicdomainrelay/logger";

const defaultLog = rawStructuredLogger("hono-pds");

export async function createFromEnv(log?: Logger): Promise<RepoFactory> {
  const lg = log ?? defaultLog;
  const keyHex = globalThis.Deno?.env.get("PDS_PRIVATE_KEY_HEX");
  let kp: Secp256k1Keypair;
  if (keyHex) {
    kp = await Secp256k1Keypair.import(keyHex);
  } else {
    kp = await Secp256k1Keypair.create();
    lg("warn", "Generated new keypair", { did: kp.did() });
  }

  const signer = signerFromKeypair(kp);
  const storage = await DenoKvStorage.create();

  const didWebServices: Array<{ id: string; type: string }> = [];
  if (globalThis.Deno?.env.get("PDS_DID_WEB_SERVICES")) {
    try {
      const parsed = JSON.parse(globalThis.Deno.env.get("PDS_DID_WEB_SERVICES")!);
      didWebServices.push(...parsed);
    } catch {
      lg("warn", "Failed to parse PDS_DID_WEB_SERVICES, ignoring");
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

export async function start(port?: number, log?: Logger): Promise<StartResult> {
  const lg = log ?? defaultLog;
  const repo = await createFromEnv(lg);
  const p = port ?? parseInt(globalThis.Deno?.env.get("PORT") ?? "2583");
  const server = Deno.serve({ port: p, hostname: "127.0.0.1" }, repo.app.fetch);
  lg("info", "PDS listening", { port: p });
  return { app: repo.app, server, repo, port: p };
}

if (import.meta.main) {
  await start();
}
