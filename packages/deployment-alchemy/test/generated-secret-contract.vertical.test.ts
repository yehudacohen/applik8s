import { describe, expect, it } from "vitest";
import { decodeGeneratedSecretConfiguration } from "../src/generated-secret-contract.js";

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
});
