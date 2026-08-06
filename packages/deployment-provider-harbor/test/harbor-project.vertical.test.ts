import type { V1Secret } from "@kubernetes/client-node";
import {
  HarborApiClient,
  type HarborKubernetesStore,
} from "typekro/harbor";
import { describe, expect, it } from "vitest";
import {
  type ApplicationHarborProjectAttributes,
  type ApplicationHarborProjectProps,
  observeApplicationHarborProjectForTest,
} from "../src/harbor-project.js";

const props: ApplicationHarborProjectProps = {
  deploymentNodeId: "external.provider.container-registry.harbor-project",
  context: "orbstack",
  endpoint: "http://harbor.example.test",
  project: "chirp",
  adminCredentials: {
    apiVersion: "v1",
    kind: "Secret",
    namespace: "harbor-system",
    name: "harbor-admin",
    username: "admin",
    passwordKey: "password",
  },
  secretNamespace: "chirp",
  policy: {},
  robots: [
    {
      name: "push",
      secretName: "chirp-registry-push",
      access: "push",
      registry: "harbor.example.test/chirp",
    },
    {
      name: "pull",
      secretName: "chirp-registry-pull",
      access: "pull",
      registry: "harbor.example.test/chirp",
    },
  ],
  allowPlainHttp: true,
  deletionPolicy: "retain",
};

const output: ApplicationHarborProjectAttributes = {
  deploymentNodeId: props.deploymentNodeId,
  project: props.project,
  projectId: 7,
  ready: true,
  robotSecretNames: ["chirp-registry-pull", "chirp-registry-push"],
};

function projectClient(status: 200 | 404): HarborApiClient {
  return new HarborApiClient({
    request: async <T>() => ({
      status,
      // typecast: the transport contract is caller-generic; this fixture deliberately returns the Harbor project response requested by the code under test.
      ...(status === 200 ? { body: { project_id: 7 } as T } : {}),
      headers: {},
    }),
  });
}

function secretStore(existing: readonly string[]): HarborKubernetesStore {
  const names = new Set(existing);
  return {
    readSecret: async (_namespace, name) =>
      names.has(name)
        ? ({
            apiVersion: "v1",
            kind: "Secret",
            metadata: { namespace: "chirp", name },
          } satisfies V1Secret)
        : undefined,
    readConfigMap: async () => undefined,
    upsertSecret: async () => undefined,
    deleteSecret: async () => undefined,
  };
}

describe("Harbor project deployment provider", () => {
  it("observes the project only when every declared robot credential Secret exists", async () => {
    await expect(
      observeApplicationHarborProjectForTest(
        props,
        output,
        { resolveCredential: async () => ({ username: "admin", password: "secret" }) },
        new AbortController().signal,
        {
          client: projectClient(200),
          store: secretStore([
            "chirp-registry-push",
            "chirp-registry-pull",
          ]),
        },
      ),
    ).resolves.toEqual(output);
  });

  it("reports drift when a retained project loses a robot credential Secret", async () => {
    await expect(
      observeApplicationHarborProjectForTest(
        props,
        output,
        { resolveCredential: async () => ({ username: "admin", password: "secret" }) },
        new AbortController().signal,
        {
          client: projectClient(200),
          store: secretStore(["chirp-registry-pull"]),
        },
      ),
    ).resolves.toBeUndefined();
  });

  it("reports drift when the Harbor project itself no longer exists", async () => {
    await expect(
      observeApplicationHarborProjectForTest(
        props,
        output,
        { resolveCredential: async () => ({ username: "admin", password: "secret" }) },
        new AbortController().signal,
        {
          client: projectClient(404),
          store: secretStore([
            "chirp-registry-push",
            "chirp-registry-pull",
          ]),
        },
      ),
    ).resolves.toBeUndefined();
  });
});
