import * as Provider from "alchemy/Provider";
import {
  type Resource as AlchemyResource,
  Resource as defineAlchemyResource,
} from "alchemy/Resource";
import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import { generatedSecretClient, readGeneratedSecret } from "./generated-secret-client.js";
import {
  type ApplicationGeneratedSecretAttributes,
  type ApplicationGeneratedSecretProps,
  applicationGeneratedSecretDeploymentNodeLabel,
  materializeApplicationGeneratedSecretValues,
  validateApplicationGeneratedSecretProps,
} from "./generated-secret-contract.js";
import {
  hostEnvironmentSecretData,
  hostEnvironmentSecretDrifted,
} from "./generated-secret-host-environment.js";
export * from "./generated-secret-contract.js";

type ApplicationGeneratedSecretResource = AlchemyResource<
  "Applik8s.GeneratedSecret",
  ApplicationGeneratedSecretProps,
  ApplicationGeneratedSecretAttributes
>;

export const ApplicationGeneratedSecret =
  defineAlchemyResource<ApplicationGeneratedSecretResource>(
    "Applik8s.GeneratedSecret",
    { defaultRemovalPolicy: "retain" },
  );

export function applicationGeneratedSecretProvider(): Layer.Layer<
  Provider.Provider<ApplicationGeneratedSecretResource>,
  never,
  never
> {
  return Provider.succeed(ApplicationGeneratedSecret, {
    version: 1,
    read: ({ olds }) =>
      Effect.tryPromise({
        try: async () => observeGeneratedSecret(olds),
        catch: toError,
      }),
    list: () => Effect.succeed([]),
    diff: ({ olds }) =>
      Effect.tryPromise({
        try: async (): Promise<{ action: "update" } | undefined> =>
          (await observeGeneratedSecret(olds))
            ? undefined
            : { action: "update" },
        catch: toError,
      }),
    reconcile: ({ news }) =>
      Effect.tryPromise({
        try: async () => reconcileGeneratedSecret(news),
        catch: toError,
      }),
    delete: ({ output, olds }) =>
      olds.deletionPolicy !== "delete" || output.ownership !== "managed"
        ? Effect.void
        : Effect.tryPromise({
            try: async () => deleteGeneratedSecret(olds, output),
            catch: toError,
          }),
  });
}

async function observeGeneratedSecret(
  props: ApplicationGeneratedSecretProps,
): Promise<ApplicationGeneratedSecretAttributes | undefined> {
  validateApplicationGeneratedSecretProps(props);
  const core = await generatedSecretClient(props.context);
  const existing = await readGeneratedSecret(core, props.namespace, props.name);
  if (!existing) return undefined;
  const keys = Object.keys(props.values).sort();
  const secretType = props.secretType ?? "Opaque";
  assertGeneratedSecretShape(existing, props, keys, secretType);
  if (
    isManagedGeneratedSecret(existing, props) &&
    hostEnvironmentSecretDrifted(existing, props)
  ) {
    return undefined;
  }
  return attributes(
    props,
    keys,
    isManagedGeneratedSecret(existing, props) ? "managed" : "external",
  );
}

async function reconcileGeneratedSecret(
  props: ApplicationGeneratedSecretProps,
): Promise<ApplicationGeneratedSecretAttributes> {
  validateApplicationGeneratedSecretProps(props);
  const core = await generatedSecretClient(props.context);
  const existing = await readGeneratedSecret(core, props.namespace, props.name);
  const keys = Object.keys(props.values).sort();
  const secretType = props.secretType ?? "Opaque";
  if (existing) {
    assertGeneratedSecretShape(existing, props, keys, secretType);
    const managed = isManagedGeneratedSecret(existing, props);
    if (managed && hostEnvironmentSecretDrifted(existing, props)) {
      const desired = hostEnvironmentSecretData(props);
      await core.replaceNamespacedSecret({
        namespace: props.namespace,
        name: props.name,
        body: {
          ...existing,
          data: {
            ...(existing.data ?? {}),
            ...desired,
          },
        },
      });
    }
    return attributes(props, keys, managed ? "managed" : "external");
  }
  const generated = materializeApplicationGeneratedSecretValues(
    props.values,
    process.env,
  );
  const data = Object.fromEntries(
    Object.entries(generated).map(([key, value]) => [
      key,
      Buffer.from(value, "utf8").toString("base64"),
    ]),
  );
  await core.createNamespacedSecret({
    namespace: props.namespace,
    body: {
      apiVersion: "v1",
      kind: "Secret",
      metadata: {
        namespace: props.namespace,
        name: props.name,
        labels: {
          "app.kubernetes.io/managed-by": "applik8s",
          "applik8s.dev/deployment-node":
            applicationGeneratedSecretDeploymentNodeLabel(
              props.deploymentNodeId,
            ),
          "applik8s.dev/generated-secret": "true",
        },
        annotations: {
          "applik8s.dev/consumers": props.consumers.join(","),
          "applik8s.dev/deployment-node": props.deploymentNodeId,
          "applik8s.dev/deployment-owner": props.deploymentOwnerId,
        },
      },
      type: secretType,
      data,
    },
  });
  return attributes(props, keys, "managed");
}

function assertGeneratedSecretShape(
  existing: NonNullable<Awaited<ReturnType<typeof readGeneratedSecret>>>,
  props: ApplicationGeneratedSecretProps,
  keys: readonly string[],
  secretType: string,
): void {
  if (
    existing.type !== secretType ||
    keys.some((key) => !existing.data?.[key])
  ) {
    throw new Error(
      `Existing generated Secret ${props.namespace}/${props.name} must be ${secretType} and contain ${keys.join(", ")}.`,
    );
  }
}

async function deleteGeneratedSecret(
  props: ApplicationGeneratedSecretProps,
  output: ApplicationGeneratedSecretAttributes,
): Promise<void> {
  const core = await generatedSecretClient(props.context);
  const existing = await readGeneratedSecret(core, output.namespace, output.name);
  if (!existing) return;
  if (!isManagedGeneratedSecret(existing, props)) {
    throw new Error(
      `Refusing to delete externally owned Secret ${output.namespace}/${output.name}.`,
    );
  }
  await core.deleteNamespacedSecret({
    namespace: output.namespace,
    name: output.name,
  });
}

function isManagedGeneratedSecret(
  secret: NonNullable<Awaited<ReturnType<typeof readGeneratedSecret>>>,
  props: ApplicationGeneratedSecretProps,
): boolean {
  const labels = secret.metadata?.labels ?? {};
  const annotations = secret.metadata?.annotations ?? {};
  return (
    (labels["applik8s.dev/deployment-node"] ===
      applicationGeneratedSecretDeploymentNodeLabel(props.deploymentNodeId) ||
      annotations["applik8s.dev/deployment-node"] === props.deploymentNodeId) &&
    annotations["applik8s.dev/deployment-owner"] === props.deploymentOwnerId
  );
}

function attributes(
  props: ApplicationGeneratedSecretProps,
  keys: readonly string[],
  ownership: "managed" | "external",
): ApplicationGeneratedSecretAttributes {
  return {
    deploymentNodeId: props.deploymentNodeId,
    namespace: props.namespace,
    name: props.name,
    keys,
    ownership,
    ready: true,
  };
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}
