import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  STATE_STORE_VERSION,
} from "alchemy/State/HttpStateApi";
import {
  type PersistedState,
  State,
  type StateService,
  StateStoreError,
} from "alchemy/State/State";
import {
  encodeState,
  reviveState,
} from "alchemy/State/StateEncoding";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

const stackOutputFile = "__stack_output__.json";

export interface ApplicationAlchemyStateOptions {
  readonly root: string;
  readonly rejectSensitiveState?: boolean;
}

export interface ApplicationAlchemyStateSummary {
  readonly stack: string;
  readonly stage: string;
  readonly exists: boolean;
  readonly resourceCount: number;
  readonly hasStackOutput: boolean;
}

/** Non-secret structural evidence used before an in-place state migration. */
export async function inspectApplicationAlchemyState(input: {
  readonly root: string;
  readonly stack: string;
  readonly stage: string;
}): Promise<ApplicationAlchemyStateSummary> {
  const directory = stagePath(
    join(input.root, "alchemy-state"),
    input.stack,
    input.stage,
  );
  const entries = await readdir(directory).catch((cause: unknown) => {
    if (errorCode(cause) === "ENOENT") return undefined;
    throw cause;
  });
  if (!entries) {
    return {
      stack: input.stack,
      stage: input.stage,
      exists: false,
      resourceCount: 0,
      hasStackOutput: false,
    };
  }
  return {
    stack: input.stack,
    stage: input.stage,
    exists: true,
    resourceCount: entries.filter((entry) =>
      entry.endsWith(".json")
      && entry !== stackOutputFile
      && !entry.includes(".backup.")
      && !entry.includes(".tmp.")).length,
    hasStackOutput: entries.includes(stackOutputFile),
  };
}

/**
 * Filesystem Alchemy state with an explicit root, atomic writes, restrictive
 * permissions, corruption errors, and a fail-closed plaintext-secret guard.
 */
export function applicationAlchemyState(
  options: ApplicationAlchemyStateOptions,
): Layer.Layer<State, never, never> {
  return Layer.succeed(
    State,
    Effect.succeed(applicationAlchemyStateService(options)),
  );
}

export function applicationAlchemyStateService(
  options: ApplicationAlchemyStateOptions,
): StateService {
  const stateRoot = join(options.root, "alchemy-state");
  const rejectSensitiveState = options.rejectSensitiveState ?? true;
  const effect = <T>(operation: () => Promise<T>) =>
    Effect.tryPromise({
      try: operation,
      catch: (cause) =>
        new StateStoreError({
          message: cause instanceof Error ? cause.message : String(cause),
          ...(cause instanceof Error ? { cause } : {}),
        }),
    });
  const service: StateService = {
    id: "applik8s-local",
    getVersion: () => Effect.succeed(STATE_STORE_VERSION),
    listStacks: () => effect(() => listDirectories(stateRoot)),
    listStages: (stack) =>
      effect(() => listDirectories(join(stateRoot, safeSegment(stack, "stack")))),
    get: (request) =>
      effect(async () => {
        const value = await readStateFile(resourcePath(stateRoot, request));
        return value === undefined ? undefined : persistedState(value);
      }),
    getReplacedResources: (request) =>
      Effect.gen(function* () {
        const fqns = yield* service.list(request);
        const states = yield* Effect.all(
          fqns.map((fqn) => service.get({ ...request, fqn })),
        );
        return states.filter(
          (state): state is Extract<PersistedState, { status: "replaced" }> =>
            state?.kind !== "action" && state?.status === "replaced",
        );
      }),
    set: (request) =>
      effect(async () => {
        if (rejectSensitiveState) assertCredentialSafeState(request.value);
        await writeStateFile(
          resourcePath(stateRoot, request),
          encodeState(request.value),
        );
        return request.value;
      }),
    delete: (request) =>
      effect(() => rm(resourcePath(stateRoot, request), { force: true })),
    deleteStack: (request) =>
      effect(() =>
        rm(
          request.stage
            ? stagePath(stateRoot, request.stack, request.stage)
            : join(stateRoot, safeSegment(request.stack, "stack")),
          { recursive: true, force: true },
        ),
      ),
    list: (request) =>
      effect(async () => {
        const directory = stagePath(stateRoot, request.stack, request.stage);
        try {
          return (await readdir(directory))
            .filter(
              (entry) =>
                entry.endsWith(".json") &&
                entry !== stackOutputFile &&
                !entry.includes(".backup.") &&
                !entry.includes(".tmp."),
            )
            .map((entry) => decodeFqn(entry.slice(0, -5)))
            .sort();
        } catch (cause) {
          if (errorCode(cause) === "ENOENT") return [];
          throw cause;
        }
      }),
    getOutput: (request) =>
      effect(() =>
        readStateFile(
          join(stagePath(stateRoot, request.stack, request.stage), stackOutputFile),
        ),
      ),
    setOutput: (request) =>
      effect(async () => {
        if (rejectSensitiveState) assertCredentialSafeState(request.value);
        await writeStateFile(
          join(stagePath(stateRoot, request.stack, request.stage), stackOutputFile),
          encodeState(request.value),
        );
        return request.value;
      }),
  };
  return service;
}

function resourcePath(
  root: string,
  request: { readonly stack: string; readonly stage: string; readonly fqn: string },
): string {
  return join(
    stagePath(root, request.stack, request.stage),
    `${encodeFqn(request.fqn)}.json`,
  );
}

function stagePath(root: string, stack: string, stage: string): string {
  return join(root, safeSegment(stack, "stack"), safeSegment(stage, "stage"));
}

function safeSegment(value: string, label: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(value) || value === "." || value === "..") {
    throw new Error(`Alchemy state ${label} ${value} is not a safe path segment.`);
  }
  return value;
}

function encodeFqn(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeFqn(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

async function listDirectories(path: string): Promise<readonly string[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map(({ name }) => name)
      .sort();
  } catch (cause) {
    if (errorCode(cause) === "ENOENT") return [];
    throw cause;
  }
}

async function readStateFile(path: string): Promise<unknown | undefined> {
  try {
    const contents = await readFile(path, "utf8");
    if (!contents.trim()) {
      throw new Error(`Alchemy state file ${path} is empty or truncated.`);
    }
    return JSON.parse(contents, reviveState);
  } catch (cause) {
    if (errorCode(cause) === "ENOENT") return undefined;
    throw cause;
  }
}

async function writeStateFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp.${randomUUID()}`;
  const backup = `${path}.backup`;
  try {
    await copyFile(path, backup);
  } catch (cause) {
    if (errorCode(cause) !== "ENOENT") throw cause;
  }
  await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(temporary, path);
}

function persistedState(value: unknown): PersistedState {
  if (!value || typeof value !== "object") {
    throw new Error("Alchemy persisted state must be an object.");
  }
  const kind = Reflect.get(value, "kind");
  if (kind === "action") {
    // typecast: Alchemy owns the versioned ActionState wire shape;
    // typecast: this store validates its object discriminator and otherwise preserves it.
    return value as PersistedState;
  }
  if (
    typeof Reflect.get(value, "resourceType") !== "string" ||
    typeof Reflect.get(value, "fqn") !== "string" ||
    typeof Reflect.get(value, "logicalId") !== "string" ||
    typeof Reflect.get(value, "status") !== "string"
  ) {
    throw new Error("Alchemy resource state is missing its required identity.");
  }
  // typecast: Alchemy validates lifecycle-specific state variants;
  // typecast: this storage boundary verifies the common persisted resource identity.
  return value as PersistedState;
}

function assertCredentialSafeState(value: unknown, path = "$"): void {
  if (!value || typeof value !== "object") return;
  if (Reflect.has(value, "__redacted__")) {
    throw new Error(
      `Alchemy state ${path} contains a resolved Redacted value. Persist a named credential binding instead.`,
    );
  }
  if (
    Reflect.get(value, "kind") === "Secret" &&
    (Reflect.has(value, "data") || Reflect.has(value, "stringData"))
  ) {
    throw new Error(
      `Alchemy state ${path} contains Kubernetes Secret bytes. Persist only a Secret reference.`,
    );
  }
  for (const [key, entry] of Object.entries(value)) {
    const entryPath = `${path}.${key}`;
    if (
      /^(token|password|privateKey|certData|keyData|kubeconfig)$/i.test(key) &&
      typeof entry === "string" &&
      entry.length > 0
    ) {
      throw new Error(
        `Alchemy state ${entryPath} contains credential material. Persist only a named binding or reference.`,
      );
    }
    if (Array.isArray(entry)) {
      for (const [index, item] of entry.entries()) {
        assertCredentialSafeState(item, `${entryPath}[${index}]`);
      }
    } else {
      assertCredentialSafeState(entry, entryPath);
    }
  }
}

function errorCode(cause: unknown): string | undefined {
  return cause && typeof cause === "object"
    ? String(Reflect.get(cause, "code") ?? "")
    : undefined;
}
