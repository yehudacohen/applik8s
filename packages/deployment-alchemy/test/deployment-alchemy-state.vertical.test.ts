import { access, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { ApplicationDeploymentIdentity } from "@applik8s/deployment-contract";
import type { PersistedState } from "alchemy/State/State";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireApplicationAlchemyLease,
  applicationAlchemyStackIdentity,
  applicationAlchemyStateService,
  assertApplicationAlchemyStackIdentityAvailable,
  claimApplicationAlchemyStackIdentity,
  inspectApplicationAlchemyStackIdentityClaim,
  inspectApplicationAlchemyState,
  releaseApplicationAlchemyStackIdentity,
  withApplicationAlchemyDeploymentLease,
} from "../src/index.js";
import { withDeploymentLease } from "../src/deployment-lease.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const path of temporaryDirectories.splice(0)) {
    await rm(path, { recursive: true, force: true });
  }
});

describe("Alchemy backend identity and state", () => {
  it("uses length-delimited full identity and persists its reverse claim", async () => {
    const root = await temporaryRoot();
    const first = applicationAlchemyStackIdentity(identity("ab", "c"), "kro");
    const second = applicationAlchemyStackIdentity(identity("a", "bc"), "kro");

    expect(first.key).not.toBe(second.key);
    expect(first.canonical).not.toBe(second.canonical);
    await claimApplicationAlchemyStackIdentity(root, first);
    await claimApplicationAlchemyStackIdentity(root, first);
  });

  it("validates plan identities without creating a durable claim", async () => {
    const root = await temporaryRoot();
    const stack = applicationAlchemyStackIdentity(identity("notes", "local"), "kro");

    await assertApplicationAlchemyStackIdentityAvailable(root, stack);

    await expect(
      access(join(root, "identities", `${stack.key}.json`)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("releases only the matching identity claim after terminal destruction", async () => {
    const root = await temporaryRoot();
    const stack = applicationAlchemyStackIdentity(identity("notes", "local"), "kro");
    await claimApplicationAlchemyStackIdentity(root, stack);

    await releaseApplicationAlchemyStackIdentity(root, stack);
    await expect(
      inspectApplicationAlchemyStackIdentityClaim(root, stack),
    ).resolves.toBeUndefined();
    await expect(
      releaseApplicationAlchemyStackIdentity(root, stack),
    ).resolves.toBeUndefined();
  });

  it("does not release a claim through a conflicting deployment strategy", async () => {
    const root = await temporaryRoot();
    const deploymentIdentity = identity("notes", "local");
    const claimed = applicationAlchemyStackIdentity(deploymentIdentity, "kro");
    await claimApplicationAlchemyStackIdentity(root, claimed);

    await expect(
      releaseApplicationAlchemyStackIdentity(
        root,
        applicationAlchemyStackIdentity(deploymentIdentity, "direct"),
      ),
    ).rejects.toThrow(/changed before it could be released/);
    await expect(
      inspectApplicationAlchemyStackIdentityClaim(root, claimed),
    ).resolves.toBeDefined();
  });

  it("rejects a conflicting persisted identity during read-only validation", async () => {
    const root = await temporaryRoot();
    const deploymentIdentity = identity("notes", "local");
    await claimApplicationAlchemyStackIdentity(
      root,
      applicationAlchemyStackIdentity(deploymentIdentity, "kro"),
    );

    await expect(
      assertApplicationAlchemyStackIdentityAvailable(
        root,
        applicationAlchemyStackIdentity(deploymentIdentity, "direct"),
      ),
    ).rejects.toThrow(/deployment strategy/);
  });

  it("keeps one stable Alchemy stack identity across installation profile transitions", async () => {
    const root = await temporaryRoot();
    const starter = applicationAlchemyStackIdentity(
      identity("notes", "starter"),
      "kro",
    );
    const dedicated = applicationAlchemyStackIdentity(
      identity("notes", "dedicated"),
      "kro",
    );

    expect(dedicated.key).toBe(starter.key);
    expect(dedicated.digest).toBe(starter.digest);
    expect(dedicated.canonical).toBe(starter.canonical);
    await claimApplicationAlchemyStackIdentity(root, starter);
    await claimApplicationAlchemyStackIdentity(root, dedicated);
  });

  it("prevents an in-place direct/KRO strategy collision for one installation identity", async () => {
    const root = await temporaryRoot();
    const deploymentIdentity = identity("notes", "local");
    await claimApplicationAlchemyStackIdentity(
      root,
      applicationAlchemyStackIdentity(deploymentIdentity, "kro"),
    );

    await expect(
      claimApplicationAlchemyStackIdentity(
        root,
        applicationAlchemyStackIdentity(deploymentIdentity, "direct"),
      ),
    ).rejects.toThrow(/deployment strategy/);
  });

  it("round-trips atomic filesystem state across service instances", async () => {
    const root = await temporaryRoot();
    const first = applicationAlchemyStateService({ root });
    await Effect.runPromise(
      first.setOutput({
        stack: "applik8s-notes-test",
        stage: "local",
        value: { endpoint: "https://notes.example.test", ready: true },
      }),
    );

    const restored = applicationAlchemyStateService({ root });
    await expect(
      Effect.runPromise(
        restored.getOutput({
          stack: "applik8s-notes-test",
          stage: "local",
        }),
      ),
    ).resolves.toEqual({
      endpoint: "https://notes.example.test",
      ready: true,
    });
    await expect(Effect.runPromise(restored.listStacks())).resolves.toEqual([
      "applik8s-notes-test",
    ]);
  });

  it("inspects identity and state structurally without exposing persisted values", async () => {
    const root = await temporaryRoot();
    const stackIdentity = applicationAlchemyStackIdentity(
      identity("notes", "local"),
      "kro",
    );
    await claimApplicationAlchemyStackIdentity(root, stackIdentity);
    const service = applicationAlchemyStateService({ root });
    const resource: PersistedState = {
      kind: "resource",
      resourceType: "Example.Resource",
      namespace: undefined,
      fqn: "example",
      logicalId: "example",
      instanceId: "instance-1",
      providerVersion: 1,
      status: "created",
      downstream: [],
      bindings: [],
      props: { revision: "one" },
      attr: { endpoint: "https://example.test" },
    };
    await Effect.runPromise(
      service.set({
        stack: stackIdentity.key,
        stage: "local",
        fqn: resource.fqn,
        value: resource,
      }),
    );
    await Effect.runPromise(
      service.setOutput({
        stack: stackIdentity.key,
        stage: "local",
        value: { ready: true },
      }),
    );

    await expect(
      inspectApplicationAlchemyStackIdentityClaim(root, stackIdentity),
    ).resolves.toMatchObject({
      version: 2,
      key: stackIdentity.key,
      digest: stackIdentity.digest,
      canonical: stackIdentity.canonical,
      strategy: "kro",
    });
    await expect(
      inspectApplicationAlchemyState({
        root,
        stack: stackIdentity.key,
        stage: "local",
      }),
    ).resolves.toEqual({
      stack: stackIdentity.key,
      stage: "local",
      exists: true,
      resourceCount: 1,
      hasStackOutput: true,
    });
    await expect(
      inspectApplicationAlchemyState({
        root,
        stack: stackIdentity.key,
        stage: "missing",
      }),
    ).resolves.toEqual({
      stack: stackIdentity.key,
      stage: "missing",
      exists: false,
      resourceCount: 0,
      hasStackOutput: false,
    });
  });

  it("rejects plaintext credentials and resolved Redacted envelopes", async () => {
    const service = applicationAlchemyStateService({
      root: await temporaryRoot(),
    });
    await expect(
      Effect.runPromise(
        service.setOutput({
          stack: "applik8s-notes-test",
          stage: "local",
          value: { password: "not-safe-for-state" },
        }),
      ),
    ).rejects.toThrow(/credential material/);
    await expect(
      Effect.runPromise(
        service.setOutput({
          stack: "applik8s-notes-test",
          stage: "local",
          value: { credential: { __redacted__: "not-safe-for-state" } },
        }),
      ),
    ).rejects.toThrow(/named credential binding/);
  });

  it("serializes one writer per Stack and releases ownership explicitly", async () => {
    const root = await temporaryRoot();
    const stack = applicationAlchemyStackIdentity(identity("notes", "local"), "kro");
    const first = await acquireApplicationAlchemyLease(root, stack, {
      owner: "first",
      ttlMs: 2_000,
      acquireTimeoutMs: 100,
      retryIntervalMs: 10,
    });
    await expect(
      acquireApplicationAlchemyLease(root, stack, {
        owner: "second",
        ttlMs: 2_000,
        acquireTimeoutMs: 30,
        retryIntervalMs: 5,
      }),
    ).rejects.toThrow(/locked by first/);
    await first.heartbeat();
    await first.release();
    const second = await acquireApplicationAlchemyLease(root, stack, {
      owner: "second",
      ttlMs: 2_000,
      acquireTimeoutMs: 100,
      retryIntervalMs: 5,
    });
    await second.release();
  });

  it("holds one operation-wide lease while nested deployment phases borrow it", async () => {
    const root = await temporaryRoot();
    const stack = applicationAlchemyStackIdentity(identity("notes", "local"), "kro");
    let nestedRan = false;

    await withApplicationAlchemyDeploymentLease(
      {
        stateRoot: root,
        owner: "migration",
        leaseTtlMs: 2_000,
      },
      stack,
      async (lease) => {
        await withDeploymentLease(
          {
            stateRoot: root,
            lease,
            leaseTtlMs: 2_000,
          },
          stack,
          async () => {
            nestedRan = true;
          },
        );
        await expect(
          acquireApplicationAlchemyLease(root, stack, {
            owner: "competing-writer",
            ttlMs: 2_000,
            acquireTimeoutMs: 30,
            retryIntervalMs: 5,
          }),
        ).rejects.toThrow(/locked by migration/);
      },
    );

    expect(nestedRan).toBe(true);
    const next = await acquireApplicationAlchemyLease(root, stack, {
      owner: "next-operation",
      ttlMs: 2_000,
      acquireTimeoutMs: 100,
      retryIntervalMs: 5,
    });
    await next.release();
  });

  it("rejects borrowing a lease from a different deployment identity", async () => {
    const root = await temporaryRoot();
    const first = applicationAlchemyStackIdentity(identity("notes", "local"), "kro");
    const second = applicationAlchemyStackIdentity(identity("tasks", "local"), "kro");
    const lease = await acquireApplicationAlchemyLease(root, first, {
      owner: "migration",
      ttlMs: 2_000,
      acquireTimeoutMs: 100,
      retryIntervalMs: 5,
    });
    await expect(
      withDeploymentLease(
        { stateRoot: root, lease, leaseTtlMs: 2_000 },
        second,
        async () => undefined,
      ),
    ).rejects.toThrow(/cannot authorize deployment/);
    await lease.release();
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(
    join(process.env.TMPDIR ?? "/tmp", "applik8s-alchemy-"),
  );
  temporaryDirectories.push(root);
  return root;
}

function identity(
  application: string,
  profile: string,
): ApplicationDeploymentIdentity {
  return {
    connection: {
      provider: "kubernetes",
      cluster: "orbstack",
      digest: `sha256:${"a".repeat(64)}`,
    },
    application,
    controlPlaneNamespace: "applik8s-system",
    instance: "notes",
    profile,
  };
}
