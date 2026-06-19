import { Command } from "@publicdomainrelay/cli-args-env";
import { Secp256k1Keypair } from "@atproto/crypto";
import { DenoKvStorage, signerFromKeypair } from "@publicdomainrelay/atproto-repo-deno";
import { createRepoFactory } from "@publicdomainrelay/hono-factory-atproto-repo-deno";
import type { RepoFactory } from "@publicdomainrelay/hono-factory-atproto-repo-deno";
import { rawStructuredLogger, type Logger } from "@publicdomainrelay/logger";
import cliArgsEnv from "./cli-args-env.json" with { type: "json" };

const defaultLog = rawStructuredLogger("hono-pds");

export interface CreateFromEnvOptions {
  keyHex?: string;
  didWebServicesStr?: string;
  log?: Logger;
}

export async function createFromEnv(opts?: CreateFromEnvOptions): Promise<RepoFactory> {
  const lg = opts?.log ?? defaultLog;
  let kp: Secp256k1Keypair;
  if (opts?.keyHex) {
    kp = await Secp256k1Keypair.import(opts.keyHex);
  } else {
    kp = await Secp256k1Keypair.create();
    lg("warn", "Generated new keypair", { did: kp.did() });
  }

  const signer = signerFromKeypair(kp);
  const storage = await DenoKvStorage.create();

  const didWebServices: Array<{ id: string; type: string }> = [];
  if (opts?.didWebServicesStr) {
    try {
      const parsed = JSON.parse(opts.didWebServicesStr);
      didWebServices.push(...parsed);
    } catch {
      lg("warn", "Failed to parse did-web-services JSON, ignoring");
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

export interface StartOptions {
  port: number;
  hostname: string;
  keyHex?: string;
  didWebServicesStr?: string;
  log?: Logger;
}

export async function start(options: StartOptions): Promise<StartResult> {
  const lg = options.log ?? defaultLog;
  const repo = await createFromEnv(options);
  const server = Deno.serve(
    { port: options.port, hostname: options.hostname, onListen: () => lg("info", "listening", { port: options.port }) },
    repo.app.fetch,
  );
  return { app: repo.app, server, repo, port: options.port };
}

if (import.meta.main) {
  let runtimeConfig = null;
  try {
    const mod = await import("./config.json", { with: { type: "json" } });
    runtimeConfig = mod.default;
  } catch { /* optional */ }

  const { options } = await new Command(
    "CONFIG_PATH_HONO_PDS",
    cliArgsEnv,
    runtimeConfig,
  ).resolve();

  const lg = rawStructuredLogger("hono-pds");
  await start({
    port: options.port as number,
    hostname: options.hostname as string,
    keyHex: options.privateKeyHex as string | undefined,
    didWebServicesStr: options.didWebServices as string | undefined,
    log: lg,
  });
}
