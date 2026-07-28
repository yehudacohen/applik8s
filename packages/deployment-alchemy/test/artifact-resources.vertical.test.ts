import {
  type ApplicationArtifactDeploymentNode,
  digestApplicationDeploymentValue,
} from "@applik8s/deployment-contract";
import { describe, expect, it } from "vitest";
import { artifactProps } from "../src/artifact-resources.js";

const FIFTEEN_MINUTES_MS = 15 * 60_000;

describe("Alchemy application artifact resources", () => {
  it("gives every generated artifact a release-grade bounded build timeout", () => {
    expect(artifactProps(artifactNode(), { type: "orbstack" }).timeout).toBe(
      FIFTEEN_MINUTES_MS,
    );
  });

  it("preserves an explicitly authored artifact build timeout", () => {
    expect(
      artifactProps(
        artifactNode({ buildTimeoutMs: 123_456 }),
        { type: "orbstack" },
      ).timeout,
    ).toBe(123_456);
  });
});

function artifactNode(
  descriptor: Readonly<Record<string, string | number>> = {},
): ApplicationArtifactDeploymentNode {
  const connectionDigest = digestApplicationDeploymentValue({
    provider: "kubernetes",
    cluster: "orbstack",
  });
  const configurationDigest = digestApplicationDeploymentValue({
    artifact: "worker",
  });
  return {
    id: "artifact.worker",
    kind: "artifact",
    contractVersion: 1,
    source: {},
    provider: {
      interface: "ContainerArtifact",
      implementation: "typekro",
      version: "1",
    },
    scope: { connectionDigest },
    capabilities: { strategies: ["direct", "kro"], alchemy: true },
    configurationDigest,
    inputs: {},
    outputs: [],
    lifecycle: {
      ownership: "application",
      deletion: "retain",
      adoption: "createOrAdoptExact",
    },
    spec: {
      artifactType: "containerImage",
      sourceDescriptor: {
        contextPath: "/tmp/applik8s-artifact",
        name: "worker",
        sourceDigest: configurationDigest,
        ...descriptor,
      },
    },
  };
}
