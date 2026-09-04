// typecast-file-boundary: persisted identity claims are unknown JSON until the complete versioned structural checks below establish their narrow protocol shape.
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ApplicationAlchemyStackIdentity } from "./identity.js";

export interface ApplicationAlchemyStackIdentityClaim {
  readonly version: 1 | 2;
  readonly key: string;
  readonly digest: string;
  readonly canonical: string;
  readonly strategy?: string;
}

/** Reads an identity claim without upgrading or otherwise mutating it. */
export async function inspectApplicationAlchemyStackIdentityClaim(
  root: string,
  stack: ApplicationAlchemyStackIdentity,
): Promise<ApplicationAlchemyStackIdentityClaim | undefined> {
  const path = join(root, "identities", `${stack.key}.json`);
  const existing = await readFile(path, "utf8").then((source) => JSON.parse(source) as unknown).catch((cause: unknown) => {
    if (errorCode(cause) === "ENOENT") return undefined;
    throw cause;
  });
  if (existing === undefined) return undefined;
  if (
    !existing
    || typeof existing !== "object"
    || (Reflect.get(existing, "version") !== 1 && Reflect.get(existing, "version") !== 2)
    || typeof Reflect.get(existing, "key") !== "string"
    || typeof Reflect.get(existing, "digest") !== "string"
    || typeof Reflect.get(existing, "canonical") !== "string"
  ) {
    throw new Error(`Alchemy Stack identity claim ${path} is corrupt.`);
  }
  const strategy = Reflect.get(existing, "strategy");
  if (strategy !== undefined && typeof strategy !== "string") {
    throw new Error(`Alchemy Stack identity claim ${path} has an invalid strategy.`);
  }
  return {
    version: Reflect.get(existing, "version") as 1 | 2,
    key: String(Reflect.get(existing, "key")),
    digest: String(Reflect.get(existing, "digest")),
    canonical: String(Reflect.get(existing, "canonical")),
    ...(strategy ? { strategy } : {}),
  };
}

export async function claimApplicationAlchemyStackIdentity(
  root: string,
  stack: ApplicationAlchemyStackIdentity,
): Promise<void> {
  const directory = join(root, "identities");
  const path = join(directory, `${stack.key}.json`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const record = JSON.stringify({
    version: 2,
    key: stack.key,
    digest: stack.digest,
    canonical: stack.canonical,
    identity: stack.identity,
    strategy: stack.strategy,
  });
  try {
    const handle = await open(path, "wx", 0o600);
    try {
      await handle.writeFile(record);
      await handle.sync();
    } finally {
      await handle.close();
    }
    return;
  } catch (cause) {
    if (errorCode(cause) !== "EEXIST") throw cause;
  }
  const existing: unknown = JSON.parse(await readFile(path, "utf8"));
  if (
    existing &&
    typeof existing === "object" &&
    Reflect.get(existing, "version") === 1 &&
    Reflect.get(existing, "key") === stack.key &&
    Reflect.get(existing, "digest") === stack.digest &&
    Reflect.get(existing, "canonical") === stack.canonical
  ) {
    if (stack.strategy !== "kro") {
      throw new Error(
        `Alchemy Stack key ${stack.key} predates strategy claims and can only be adopted as kro; use a distinct installation identity for direct mode.`,
      );
    }
    const temporary = `${path}.tmp.${randomUUID()}`;
    await writeFile(temporary, record, { mode: 0o600 });
    await rename(temporary, path);
    return;
  }
  if (
    !existing ||
    typeof existing !== "object" ||
    Reflect.get(existing, "version") !== 2 ||
    Reflect.get(existing, "key") !== stack.key ||
    Reflect.get(existing, "digest") !== stack.digest ||
    Reflect.get(existing, "canonical") !== stack.canonical ||
    Reflect.get(existing, "strategy") !== stack.strategy
  ) {
    throw new Error(
      `Alchemy Stack key ${stack.key} is already claimed by a different identity, deployment strategy, or corrupt record.`,
    );
  }
}

/**
 * Releases the reverse identity claim after the corresponding Alchemy stack
 * has reached its terminal destroyed state. Callers must hold the deployment
 * lease: removing this claim while resources or state remain would allow a
 * different strategy to adopt the same physical installation.
 */
export async function releaseApplicationAlchemyStackIdentity(
  root: string,
  stack: ApplicationAlchemyStackIdentity,
): Promise<void> {
  const path = join(root, "identities", `${stack.key}.json`);
  const existing = await inspectApplicationAlchemyStackIdentityClaim(root, stack);
  if (existing === undefined) return;
  if (
    existing.key !== stack.key
    || existing.digest !== stack.digest
    || existing.canonical !== stack.canonical
    || (existing.version === 2 && existing.strategy !== stack.strategy)
  ) {
    throw new Error(
      `Alchemy Stack identity claim ${path} changed before it could be released.`,
    );
  }
  await rm(path, { force: true });
}

/**
 * Verifies that a stack identity is either unclaimed or already claimed by the
 * same deployment without creating or upgrading durable state. Planning uses
 * this boundary so a read-only preview cannot leave half of an identity/state
 * pair behind.
 */
export async function assertApplicationAlchemyStackIdentityAvailable(
  root: string,
  stack: ApplicationAlchemyStackIdentity,
): Promise<void> {
  const path = join(root, "identities", `${stack.key}.json`);
  const existing = await readFile(path, "utf8")
    .then((source) => JSON.parse(source) as unknown)
    .catch((cause: unknown) => {
      if (errorCode(cause) === "ENOENT") return undefined;
      throw cause;
    });
  if (existing === undefined) return;
  if (
    existing
    && typeof existing === "object"
    && Reflect.get(existing, "version") === 1
    && Reflect.get(existing, "key") === stack.key
    && Reflect.get(existing, "digest") === stack.digest
    && Reflect.get(existing, "canonical") === stack.canonical
  ) {
    if (stack.strategy !== "kro") {
      throw new Error(
        `Alchemy Stack key ${stack.key} predates strategy claims and can only be adopted as kro; use a distinct installation identity for direct mode.`,
      );
    }
    return;
  }
  if (
    !existing
    || typeof existing !== "object"
    || Reflect.get(existing, "version") !== 2
    || Reflect.get(existing, "key") !== stack.key
    || Reflect.get(existing, "digest") !== stack.digest
    || Reflect.get(existing, "canonical") !== stack.canonical
    || Reflect.get(existing, "strategy") !== stack.strategy
  ) {
    throw new Error(
      `Alchemy Stack key ${stack.key} is already claimed by a different identity, deployment strategy, or corrupt record.`,
    );
  }
}

function errorCode(cause: unknown): string | undefined {
  return cause && typeof cause === "object"
    ? String(Reflect.get(cause, "code") ?? "")
    : undefined;
}
