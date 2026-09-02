import { describe, expect, it } from "vitest";
import {
  type ApplicationGeneratedSecretProps,
  applicationGeneratedSecretDeploymentNodeLabel,
  materializeApplicationGeneratedSecretValues,
  validateApplicationGeneratedSecretProps,
} from "../src/index.js";

const base: Omit<ApplicationGeneratedSecretProps, "values"> = {
  deploymentNodeId: "external.generated-secret.chirp.hatchet",
  deploymentOwnerId:
    "sha256:6dab8e68aedb65dfa3d705f92825b7cf71a8fffb157beccd2b0e84f56a061204",
  context: "orbstack",
  namespace: "chirp",
  name: "hatchet-admin",
  consumers: ["provider.workflow-engine"],
  deletionPolicy: "delete",
};

describe("Kubernetes generated-Secret deployment provider", () => {
  it("resolves host credentials only from the operation environment", () => {
    const values = { // typecast: preserve literal discriminants for the public codec.
      apiKey: {
        kind: "hostEnvironment",
        name: "SYNTHETIC_PROVIDER_API_KEY",
      },
    } satisfies ApplicationGeneratedSecretProps['values'];
    expect(() =>
      validateApplicationGeneratedSecretProps({ ...base, values }),
    ).not.toThrow();
    expect(
      materializeApplicationGeneratedSecretValues(values, {
        SYNTHETIC_PROVIDER_API_KEY: "provider-value",
      }),
    ).toEqual({ apiKey: "provider-value" });
    expect(() =>
      materializeApplicationGeneratedSecretValues(values, {}),
    ).toThrow(/SYNTHETIC_PROVIDER_API_KEY/);
    expect(JSON.stringify({ ...base, values })).not.toContain(
      "provider-value",
    );
  });

  it('extracts structured credentials and encodes derived URI components', () => {
    const values: ApplicationGeneratedSecretProps['values'] = {
      username: {
        kind: 'hostEnvironmentJson',
        name: 'CLICKHOUSE_CREDENTIALS',
        property: 'username',
      },
      password: {
        kind: 'hostEnvironment',
        name: 'POSTGRES_PASSWORD',
      },
      uri: {
        kind: 'template',
        segments: [
          { kind: 'literal', value: 'postgresql://user:' },
          { kind: 'value', key: 'password', transform: 'uriComponent' },
          { kind: 'literal', value: '@postgres.example.test/application' },
        ],
      },
    };
    expect(() => validateApplicationGeneratedSecretProps({ ...base, values })).not.toThrow();
    expect(materializeApplicationGeneratedSecretValues(values, {
      CLICKHOUSE_CREDENTIALS: JSON.stringify({ username: 'analytics', password: 'unused' }),
      POSTGRES_PASSWORD: 'p@ss/word',
    })).toEqual({
      username: 'analytics',
      password: 'p@ss/word',
      uri: 'postgresql://user:p%40ss%2Fword@postgres.example.test/application',
    });
    expect(() => materializeApplicationGeneratedSecretValues(values, {
      CLICKHOUSE_CREDENTIALS: JSON.stringify({ username: 42 }),
      POSTGRES_PASSWORD: 'configured',
    })).toThrow(/username/u);
  });

  it("accepts random credentials and explicitly public metadata", () => {
    expect(() =>
      validateApplicationGeneratedSecretProps({
        ...base,
        values: {
          adminEmail: {
            kind: "publicLiteral",
            value: "admin@applik8s.local",
          },
          adminPassword: {
            kind: "random",
            bytes: 32,
            encoding: "base64url",
          },
        },
      }),
    ).not.toThrow();
  });

  it("preserves the generation entropy floor for provider-bounded values", () => {
    // typecast: preserve the literal random-value discriminant while testing the provider contract.
    const values = {
      cookie: {
        kind: "random",
        bytes: 32,
        encoding: "base64url",
        characters: 32,
      },
    } as const;
    expect(() =>
      validateApplicationGeneratedSecretProps({
        ...base,
        values,
      }),
    ).not.toThrow();
    expect(
      materializeApplicationGeneratedSecretValues(values).cookie,
    ).toHaveLength(32);
    expect(() =>
      validateApplicationGeneratedSecretProps({
        ...base,
        values: {
          cookie: {
            kind: "random",
            bytes: 32,
            encoding: "base64url",
            characters: 31,
          },
        },
      }),
    ).toThrow(/unsafe random value contract/);
  });

  it("accepts a private RSA JWK Set generation contract without carrying key material", () => {
    expect(() =>
      validateApplicationGeneratedSecretProps({
        ...base,
        values: {
          jwks: {
            kind: "jwkSet",
            algorithm: "RS256",
            modulusLength: 2048,
            keyId: "oathkeeper-id-token-v1",
          },
        },
      }),
    ).not.toThrow();
  });

  it("derives a connection value from a generated sibling without persisting the resolved secret", () => {
    // typecast: preserve the literal generation discriminants for the public provider contract.
    const values = {
      username: {
        kind: "publicLiteral",
        value: "hatchet",
      },
      password: {
        kind: "random",
        bytes: 32,
        encoding: "base64url",
      },
      DATABASE_URL: {
        kind: "template",
        segments: [
          { kind: "literal", value: "postgresql://hatchet:" },
          { kind: "value", key: "password" },
          {
            kind: "literal",
            value:
              "@hatchet-db-rw.workflow-system.svc.cluster.local:5432/hatchet?sslmode=require",
          },
        ],
      },
    } as const;
    expect(() =>
      validateApplicationGeneratedSecretProps({
        ...base,
        secretType: "kubernetes.io/basic-auth",
        values,
      }),
    ).not.toThrow();
    const generated = materializeApplicationGeneratedSecretValues(values);
    expect(generated.password).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generated.DATABASE_URL).toBe(
      `postgresql://hatchet:${generated.password}@hatchet-db-rw.workflow-system.svc.cluster.local:5432/hatchet?sslmode=require`,
    );
  });

  it("rejects missing and cyclic derived Secret values", () => {
    expect(() =>
      validateApplicationGeneratedSecretProps({
        ...base,
        values: {
          first: {
            kind: "template",
            segments: [{ kind: "value", key: "second" }],
          },
          second: {
            kind: "template",
            segments: [{ kind: "value", key: "first" }],
          },
        },
      }),
    ).toThrow(/missing or cyclic/);
  });

  it("rejects unsafe JWK Set generation parameters", () => {
    expect(() =>
      validateApplicationGeneratedSecretProps({
        ...base,
        values: {
          jwks: {
            kind: "jwkSet",
            algorithm: "RS256",
            modulusLength: 2048,
            keyId: "not a Kubernetes-safe identity",
          },
        },
      }),
    ).toThrow(/unsafe JWK Set/);
  });

  it("rejects sensitive literals before they can enter Alchemy state", () => {
    const props: ApplicationGeneratedSecretProps = {
      ...base,
      values: {
        adminPassword: {
          kind: "publicLiteral",
          value: "must-not-enter-state",
        },
      },
    };

    expect(() => validateApplicationGeneratedSecretProps(props)).toThrow(
      /cannot persist sensitive/,
    );
  });

  it("requires installation ownership in addition to the graph-local node id", () => {
    expect(() =>
      validateApplicationGeneratedSecretProps({
        ...base,
        deploymentOwnerId: "",
        values: {
          token: {
            kind: "random",
            bytes: 32,
            encoding: "base64url",
          },
        },
      }),
    ).toThrow(/requires node, owner, context/);
  });

  it("projects long graph identities into stable collision-resistant Kubernetes label values", () => {
    const first =
      "external.generated-secret.applik8s-v06-guestbook-53810.guestbook-start-live-web-gateway-cursor";
    const second = `${first}-other`;
    const projected = applicationGeneratedSecretDeploymentNodeLabel(first);
    expect(projected).toMatch(
      /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/,
    );
    expect(projected.length).toBeLessThanOrEqual(63);
    expect(projected).not.toBe(
      applicationGeneratedSecretDeploymentNodeLabel(second),
    );
    expect(projected).toBe(
      applicationGeneratedSecretDeploymentNodeLabel(first),
    );
  });
});
