import * as Test from "alchemy/Test/Core";
import * as Effect from "effect/Effect";
import type { ContainerBuildOptions } from "typekro/containers";
import { describe, expect, it } from "vitest";
import {
  ApplicationContainerArtifact,
  applicationContainerArtifactProvider,
} from "../src/index.js";

describe("Alchemy container artifact provider", () => {
  it("reconciles immutable outputs once and lets Alchemy no-op identical input", async () => {
    let builds = 0;
    const provider = applicationContainerArtifactProvider({
      build: async (options) => {
        builds += 1;
        expect(options.existingTagPolicy).toBe("adopt");
        return {
          deploymentNodeId: "artifact.web",
          sourceDigest: `sha256:${"a".repeat(64)}`,
          immutableReference: `registry.example/applik8s/${options.imageName}@sha256:${"b".repeat(64)}`,
          taggedReference: `registry.example/applik8s/${options.imageName}:${options.tag}`,
          repository: `registry.example/applik8s/${options.imageName}`,
          tag: options.tag ?? "latest",
          digest: `sha256:${"b".repeat(64)}`,
          pushed: true,
          platforms: ["linux/amd64", "linux/arm64"],
        };
      },
    });
    const scratch = Test.scratchStack(
      { providers: provider, stage: "test" },
      "applik8s-artifact-provider",
    );
    const program = Effect.gen(function* () {
      return yield* ApplicationContainerArtifact("artifact.web", {
        deploymentNodeId: "artifact.web",
        sourceDigest: `sha256:${"a".repeat(64)}`,
        context: "/workspace/web",
        dockerfile: "Dockerfile",
        imageName: "web",
        tag: "sha-source",
        existingTagPolicy: "adopt",
        registry: {
          type: "oci",
          registry: "https://registry.example",
          repositoryPrefix: "applik8s",
        },
      });
    });

    const first = await Test.run(scratch.deploy(program), {
      providers: provider,
    });
    const second = await Test.run(scratch.deploy(program), {
      providers: provider,
    });
    expect(builds).toBe(1);
    expect(first.immutableReference).toBe(
      `registry.example/applik8s/web@sha256:${"b".repeat(64)}`,
    );
    expect(first.publishedImmutableReference).toBe(first.immutableReference);
    expect(first.publishedTaggedReference).toBe(first.taggedReference);
    expect(second.immutableReference).toBe(first.immutableReference);
    await Test.run(scratch.destroy(), { providers: provider });
  });

  it("rebuilds an OrbStack artifact when persisted state points at a missing local image", async () => {
    let builds = 0;
    let inspections = 0;
    const provider = applicationContainerArtifactProvider({
      localImageExists: async (reference) => {
        inspections += 1;
        expect(reference).toBe("web:sha-source");
        return false;
      },
      build: async (options) => {
        builds += 1;
        return {
          deploymentNodeId: "artifact.web",
          sourceDigest: `sha256:${"a".repeat(64)}`,
          immutableReference: "web@sha256:local",
          taggedReference: `web:${options.tag}`,
          repository: "web",
          tag: options.tag ?? "latest",
          digest: "sha256:local",
          pushed: false,
          platforms: ["linux/arm64"],
        };
      },
    });
    const scratch = Test.scratchStack(
      { providers: provider, stage: "test" },
      "applik8s-artifact-local-refresh",
    );
    const program = Effect.gen(function* () {
      return yield* ApplicationContainerArtifact("artifact.web", {
        deploymentNodeId: "artifact.web",
        sourceDigest: `sha256:${"a".repeat(64)}`,
        context: "/workspace/web",
        imageName: "web",
        tag: "sha-source",
        existingTagPolicy: "adopt",
        registry: { type: "orbstack" },
      });
    });

    await Test.run(scratch.deploy(program), { providers: provider });
    await Test.run(scratch.deploy(program), { providers: provider });
    expect(inspections).toBe(1);
    expect(builds).toBe(2);
    await Test.run(scratch.destroy(), { providers: provider });
  });

  it("fails closed when a local image cannot be inspected", async () => {
    let builds = 0;
    const provider = applicationContainerArtifactProvider({
      localImageExists: async () => {
        throw new Error("Docker daemon is unavailable");
      },
      build: async (options) => {
        builds += 1;
        return {
          deploymentNodeId: "artifact.web",
          sourceDigest: `sha256:${"a".repeat(64)}`,
          immutableReference: "web@sha256:local",
          taggedReference: `web:${options.tag}`,
          repository: "web",
          tag: options.tag ?? "latest",
          digest: "sha256:local",
          pushed: false,
          platforms: ["linux/arm64"],
        };
      },
    });
    const scratch = Test.scratchStack(
      { providers: provider, stage: "test" },
      "applik8s-artifact-local-inspection-error",
    );
    const program = Effect.gen(function* () {
      return yield* ApplicationContainerArtifact("artifact.web", {
        deploymentNodeId: "artifact.web",
        sourceDigest: `sha256:${"a".repeat(64)}`,
        context: "/workspace/web",
        imageName: "web",
        tag: "sha-source",
        registry: { type: "orbstack" },
      });
    });

    await Test.run(scratch.deploy(program), { providers: provider });
    await expect(
      Test.run(scratch.deploy(program), { providers: provider }),
    ).rejects.toThrow(/Docker daemon is unavailable/);
    expect(builds).toBe(1);
    await Test.run(scratch.destroy(), { providers: provider });
  });

  it("rejects secret-shaped build arguments before invoking a builder", async () => {
    const provider = applicationContainerArtifactProvider({
      build: async () => {
        throw new Error("builder must not run");
      },
    });
    const scratch = Test.scratchStack(
      { providers: provider, stage: "test" },
      "applik8s-artifact-secret",
    );
    await expect(
      Test.run(
        scratch.deploy(
          Effect.gen(function* () {
            return yield* ApplicationContainerArtifact("artifact.web", {
              deploymentNodeId: "artifact.web",
              sourceDigest: `sha256:${"a".repeat(64)}`,
              context: "/workspace/web",
              imageName: "web",
              buildArgs: { REGISTRY_PASSWORD: "unsafe" },
              registry: { type: "orbstack" },
            });
          }),
        ),
        { providers: provider },
      ),
    ).rejects.toThrow(/Build secrets require an ephemeral secret mount/);
  });

  it("publishes through the host endpoint but returns node-visible references", async () => {
    const provider = applicationContainerArtifactProvider({
      build: async (options) => ({
        deploymentNodeId: "artifact.web",
        sourceDigest: `sha256:${"a".repeat(64)}`,
        immutableReference: `192.168.64.2:32080/chirp/web@sha256:${"b".repeat(64)}`,
        taggedReference: `192.168.64.2:32080/chirp/web:${options.tag}`,
        repository: "192.168.64.2:32080/chirp/web",
        tag: options.tag ?? "latest",
        digest: `sha256:${"b".repeat(64)}`,
        pushed: true,
        platforms: ["linux/arm64"],
      }),
    });
    const scratch = Test.scratchStack(
      { providers: provider, stage: "test" },
      "applik8s-artifact-projection",
    );
    const result = await Test.run(
      scratch.deploy(
        Effect.gen(function* () {
          return yield* ApplicationContainerArtifact("artifact.web", {
            deploymentNodeId: "artifact.web",
            sourceDigest: `sha256:${"a".repeat(64)}`,
            context: "/workspace/web",
            imageName: "web",
            tag: "sha-source",
            registry: {
              type: "harbor",
              registry: "http://192.168.64.2:32080",
              project: "chirp",
              deploymentRegistry: "http://127.0.0.1:32080",
              deploymentProject: "chirp-runtime",
            },
          });
        }),
      ),
      { providers: provider },
    );
    expect(result.immutableReference).toBe(
      `127.0.0.1:32080/chirp-runtime/web@sha256:${"b".repeat(64)}`,
    );
    expect(result.publishedImmutableReference).toBe(
      `192.168.64.2:32080/chirp/web@sha256:${"b".repeat(64)}`,
    );
    expect(result.taggedReference).toBe(
      "127.0.0.1:32080/chirp-runtime/web:sha-source",
    );
    await Test.run(scratch.destroy(), { providers: provider });
  });

  it("bounds independent artifact builds to the safe default across one provider", async () => {
    let active = 0;
    let peak = 0;
    const provider = applicationContainerArtifactProvider({
      build: async (options) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 15));
        active -= 1;
        return {
          deploymentNodeId: `artifact.${options.imageName}`,
          sourceDigest: `sha256:${"a".repeat(64)}`,
          immutableReference: `registry.example/${options.imageName}@sha256:${"b".repeat(64)}`,
          taggedReference: `registry.example/${options.imageName}:test`,
          repository: `registry.example/${options.imageName}`,
          tag: "test",
          digest: `sha256:${"b".repeat(64)}`,
          pushed: true,
          platforms: ["linux/arm64"],
        };
      },
    });
    const scratch = Test.scratchStack(
      { providers: provider, stage: "test" },
      "applik8s-artifact-concurrency",
    );
    await Test.run(
      scratch.deploy(
        Effect.gen(function* () {
          return yield* Effect.all(
            Array.from({ length: 6 }, (_, index) =>
              ApplicationContainerArtifact(`artifact.worker-${index}`, {
                deploymentNodeId: `artifact.worker-${index}`,
                sourceDigest: `sha256:${"a".repeat(64)}`,
                context: `/workspace/worker-${index}`,
                imageName: `worker-${index}`,
                registry: { type: "orbstack" },
              }),
            ),
            { concurrency: "unbounded" },
          );
        }),
      ),
      { providers: provider },
    );
    expect(peak).toBe(1);
    await Test.run(scratch.destroy(), { providers: provider });
  });

  it("shares the safe default across separately materialized provider layers", async () => {
    let active = 0;
    let peak = 0;
    const build = async (options: ContainerBuildOptions) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active -= 1;
      return {
        deploymentNodeId: `artifact.${options.imageName}`,
        sourceDigest: `sha256:${"a".repeat(64)}`,
        immutableReference: `registry.example/${options.imageName}@sha256:${"b".repeat(64)}`,
        taggedReference: `registry.example/${options.imageName}:test`,
        repository: `registry.example/${options.imageName}`,
        tag: "test",
        digest: `sha256:${"b".repeat(64)}`,
        pushed: true,
        platforms: ["linux/arm64"],
      };
    };
    const providers = [
      applicationContainerArtifactProvider({ build }),
      applicationContainerArtifactProvider({ build }),
    ];
    const fixtures = providers.map((provider, index) => ({
      provider,
      scratch: Test.scratchStack(
        { providers: provider, stage: "test" },
        `applik8s-artifact-provider-layer-${index}`,
      ),
    }));
    await Promise.all(
      fixtures.map(({ provider, scratch }, stackIndex) =>
        Test.run(
          scratch.deploy(
            Effect.gen(function* () {
              return yield* Effect.all(
                Array.from({ length: 3 }, (_, index) =>
                  ApplicationContainerArtifact(
                    `artifact.layer-${stackIndex}-${index}`,
                    {
                      deploymentNodeId: `artifact.layer-${stackIndex}-${index}`,
                      sourceDigest: `sha256:${"a".repeat(64)}`,
                      context: `/workspace/layer-${stackIndex}-${index}`,
                      imageName: `layer-${stackIndex}-${index}`,
                      registry: { type: "orbstack" },
                    },
                  ),
                ),
                { concurrency: "unbounded" },
              );
            }),
          ),
          { providers: provider },
        ),
      ),
    );
    expect(peak).toBe(1);
    await Promise.all(
      fixtures.map(({ provider, scratch }) =>
        Test.run(scratch.destroy(), { providers: provider }),
      ),
    );
  });
});
