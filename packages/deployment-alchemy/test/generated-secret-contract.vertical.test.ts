import { describe, expect, it } from "vitest";
import { decodeGeneratedSecretConfiguration } from "../src/generated-secret-contract.js";

describe("Alchemy generated-Secret graph contract", () => {
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
