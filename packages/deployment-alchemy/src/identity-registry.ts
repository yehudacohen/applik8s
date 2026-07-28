import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ApplicationAlchemyStackIdentity } from "./identity.js";

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

function errorCode(cause: unknown): string | undefined {
  return cause && typeof cause === "object"
    ? String(Reflect.get(cause, "code") ?? "")
    : undefined;
}
