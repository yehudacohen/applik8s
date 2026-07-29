import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { ApplicationDeploymentIdentity } from "@applik8s/deployment-contract";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireApplicationAlchemyLease,
  applicationAlchemyStackIdentity,
  applicationAlchemyStateService,
  claimApplicationAlchemyStackIdentity,
} from "../src/index.js";

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
