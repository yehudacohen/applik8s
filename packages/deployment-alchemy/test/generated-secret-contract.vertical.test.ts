import type {
  ApplicationExternalProviderDeploymentNode,
  DeploymentJsonObject,
} from "@applik8s/deployment-contract";
import { describe, expect, it } from "vitest";
import { decodeGeneratedSecretConfiguration } from "../src/generated-secret-contract.js";
import { assertGeneratedSecretHostEnvironmentAvailable } from "../src/generated-secrets.js";

describe("Alchemy generated-Secret graph contract", () => {
  it("decodes an operation-host binding without admitting its value", () => {
    const decoded = decodeGeneratedSecretConfiguration(
      {
        namespace: "developer-system",
        name: "inference",
        consumers: ["provider.AI.inference"],
        values: {
          apiKey: {
            kind: "hostEnvironment",
            name: "SYNTHETIC_PROVIDER_API_KEY",
          },
        },
      },
      "external.generated-secret.agentic-developer.inference",
    );
    expect(decoded.values.apiKey).toEqual({
      kind: "hostEnvironment",
      name: "SYNTHETIC_PROVIDER_API_KEY",
    });
    expect(JSON.stringify(decoded)).not.toContain("provider-value");
  });

  it('preserves JSON extraction and URI-component transforms', () => {
    const decoded = decodeGeneratedSecretConfiguration({
      namespace: 'application',
      name: 'external-database',
      consumers: ['provider.TransactionalDatabase.primary'],
      values: {
        username: {
          kind: 'hostEnvironmentJson',
          name: 'DATABASE_CREDENTIALS',
          property: 'username',
        },
        uri: {
          kind: 'template',
          segments: [
            { kind: 'literal', value: 'postgresql://' },
            { kind: 'value', key: 'username', transform: 'uriComponent' },
          ],
        },
      },
    }, 'external.generated-secret.database');
    expect(decoded.values).toEqual({
      username: {
        kind: 'hostEnvironmentJson',
        name: 'DATABASE_CREDENTIALS',
        property: 'username',
      },
      uri: {
        kind: 'template',
        segments: [
          { kind: 'literal', value: 'postgresql://' },
          { kind: 'value', key: 'username', transform: 'uriComponent' },
        ],
      },
    });
  });

  it("preserves provider-bounded random value length", () => {
    expect(
      decodeGeneratedSecretConfiguration(
        {
          namespace: "identity-system",
          name: "kratos-secrets",
          consumers: ["identity"],
          values: {
            cookie: {
              kind: "random",
              bytes: 32,
              encoding: "base64url",
              characters: 32,
            },
          },
        },
        "external.provider.identity.kratos-secrets",
      ).values.cookie,
    ).toEqual({
      kind: "random",
      bytes: 32,
      encoding: "base64url",
      characters: 32,
    });
  });

  it("rejects every missing operation-host binding before provider reconciliation", () => {
    const node = generatedSecretNode({
      apiKey: {
        kind: "hostEnvironment",
        name: "SYNTHETIC_PROVIDER_API_KEY",
      },
      webhook: {
        kind: "hostEnvironment",
        name: "SYNTHETIC_WEBHOOK_SECRET",
      },
    });

    expect(() =>
      assertGeneratedSecretHostEnvironmentAvailable([node], {
        SYNTHETIC_PROVIDER_API_KEY: "configured",
        SYNTHETIC_WEBHOOK_SECRET: "",
      }),
    ).toThrow(
      /SYNTHETIC_WEBHOOK_SECRET .*no provider resources were changed/,
    );
    expect(() =>
      assertGeneratedSecretHostEnvironmentAvailable([node], {
        SYNTHETIC_PROVIDER_API_KEY: "configured",
        SYNTHETIC_WEBHOOK_SECRET: "configured",
      }),
    ).not.toThrow();
  });
});

function generatedSecretNode(
  values: DeploymentJsonObject,
): ApplicationExternalProviderDeploymentNode {
  return {
    id: "external.generated-secret.synthetic",
    kind: "externalProvider",
    contractVersion: 1,
    source: { semanticNodeId: "provider.synthetic" },
    provider: {
      interface: "Secret",
      implementation: "alchemy-kubernetes-generated-secret",
      version: "1",
    },
    scope: {
      connectionDigest: `sha256:${"a".repeat(64)}`,
      namespace: "synthetic-system",
    },
    capabilities: { strategies: ["direct", "kro"], alchemy: true },
    configurationDigest: `sha256:${"b".repeat(64)}`,
    inputs: {},
    outputs: [],
    lifecycle: {
      ownership: "application",
      deletion: "delete",
      adoption: "createOrAdoptExact",
    },
    spec: {
      resourceType: "kubernetesGeneratedSecret",
      controller: "applik8s-alchemy-kubernetes-generated-secret/v1",
      referenceMode: "staticIdentity",
      configuration: {
        namespace: "synthetic-system",
        name: "synthetic",
        consumers: ["provider.synthetic"],
        values,
      },
    },
  };
}
