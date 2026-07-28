import { describe, expect, it } from "vitest";
import {
  type ApplicationGeneratedSecretProps,
  applicationGeneratedSecretDeploymentNodeLabel,
  validateApplicationGeneratedSecretProps,
} from "../src/index.js";

const base: Omit<ApplicationGeneratedSecretProps, "values"> = {
  deploymentNodeId: "external.generated-secret.chirp.hatchet",
  context: "orbstack",
  namespace: "chirp",
  name: "hatchet-admin",
  consumers: ["provider.workflow-engine"],
  deletionPolicy: "delete",
};

describe("Kubernetes generated-Secret deployment provider", () => {
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
