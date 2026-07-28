import { createHash, randomBytes } from "node:crypto";
import * as Provider from "alchemy/Provider";
import {
  type Resource as AlchemyResource,
  Resource as defineAlchemyResource,
} from "alchemy/Resource";
import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";

export type ApplicationGeneratedSecretValue =
  | {
      readonly kind: "random";
      readonly bytes: number;
      readonly encoding: "base64url";
    }
  | {
      readonly kind: "publicLiteral";
      readonly value: string;
    };

export interface ApplicationGeneratedSecretProps {
  readonly deploymentNodeId: string;
  readonly context: string;
  readonly namespace: string;
  readonly name: string;
  readonly values: Readonly<Record<string, ApplicationGeneratedSecretValue>>;
  readonly consumers: readonly string[];
  readonly deletionPolicy: "delete" | "retain";
  /** Alchemy dependency handles; values contain no credential material. */
  readonly prerequisites?: readonly unknown[];
}

export interface ApplicationGeneratedSecretAttributes {
  readonly deploymentNodeId: string;
  readonly namespace: string;
  readonly name: string;
  readonly keys: readonly string[];
  readonly ownership: "managed" | "external";
  readonly ready: true;
}

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
    read: ({ output }) => Effect.succeed(output),
    list: () => Effect.succeed([]),
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

async function reconcileGeneratedSecret(
  props: ApplicationGeneratedSecretProps,
): Promise<ApplicationGeneratedSecretAttributes> {
  validateApplicationGeneratedSecretProps(props);
  // Load the SDK only inside the effectful operation host.
  // static-import-exception: keep the provider declaration/state surface portable.
  const kubernetes = await import("@kubernetes/client-node");
  const config = new kubernetes.KubeConfig();
  config.loadFromDefault();
  config.setCurrentContext(props.context);
  const core = config.makeApiClient(kubernetes.CoreV1Api);
  const existing = await core
    .readNamespacedSecret({
      namespace: props.namespace,
      name: props.name,
    })
    .catch((cause: unknown) => {
      if (statusCode(cause) === 404) return undefined;
      throw cause;
    });
  const keys = Object.keys(props.values).sort();
  if (existing) {
    if (
      existing.type !== "Opaque" ||
      keys.some((key) => !existing.data?.[key])
    ) {
      throw new Error(
        `Existing generated Secret ${props.namespace}/${props.name} must be Opaque and contain ${keys.join(", ")}.`,
      );
    }
    const labels = existing.metadata?.labels ?? {};
    const annotations = existing.metadata?.annotations ?? {};
    const managed =
      labels["applik8s.dev/deployment-node"] ===
        applicationGeneratedSecretDeploymentNodeLabel(props.deploymentNodeId) ||
      annotations["applik8s.dev/deployment-node"] === props.deploymentNodeId;
    return attributes(props, keys, managed ? "managed" : "external");
  }
  const data = Object.fromEntries(
    Object.entries(props.values).map(([key, contract]) => [
      key,
      Buffer.from(generatedValue(contract), "utf8").toString("base64"),
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
        },
      },
      type: "Opaque",
      data,
    },
  });
  return attributes(props, keys, "managed");
}

async function deleteGeneratedSecret(
  props: ApplicationGeneratedSecretProps,
  output: ApplicationGeneratedSecretAttributes,
): Promise<void> {
  // static-import-exception: load the Kubernetes SDK only for effectful delete.
  const kubernetes = await import("@kubernetes/client-node");
  const config = new kubernetes.KubeConfig();
  config.loadFromDefault();
  config.setCurrentContext(props.context);
  const core = config.makeApiClient(kubernetes.CoreV1Api);
  const existing = await core
    .readNamespacedSecret({
      namespace: output.namespace,
      name: output.name,
    })
    .catch((cause: unknown) => {
      if (statusCode(cause) === 404) return undefined;
      throw cause;
    });
  if (!existing) return;
  const labels = existing.metadata?.labels ?? {};
  const annotations = existing.metadata?.annotations ?? {};
  if (
    labels["applik8s.dev/deployment-node"] !==
      applicationGeneratedSecretDeploymentNodeLabel(props.deploymentNodeId) &&
    annotations["applik8s.dev/deployment-node"] !== props.deploymentNodeId
  ) {
    throw new Error(
      `Refusing to delete externally owned Secret ${output.namespace}/${output.name}.`,
    );
  }
  await core.deleteNamespacedSecret({
    namespace: output.namespace,
    name: output.name,
  });
}

/** Stable Kubernetes-label projection; the full graph identity remains in an annotation and Alchemy state. */
export function applicationGeneratedSecretDeploymentNodeLabel(
  deploymentNodeId: string,
): string {
  const value = deploymentNodeId.trim();
  if (
    value.length <= 63 &&
    /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(value)
  ) {
    return value;
  }
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 12);
  const readable = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")
    .slice(0, 50)
    .replace(/[^a-z0-9]+$/g, "");
  return `${readable || "deployment-node"}-${digest}`;
}

function generatedValue(contract: ApplicationGeneratedSecretValue): string {
  if (contract.kind === "publicLiteral") return contract.value;
  return randomBytes(contract.bytes).toString(contract.encoding);
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

export function validateApplicationGeneratedSecretProps(
  props: ApplicationGeneratedSecretProps,
): void {
  if (
    !props.deploymentNodeId.trim() ||
    !props.context.trim() ||
    !props.namespace.trim() ||
    !props.name.trim() ||
    Object.keys(props.values).length === 0
  ) {
    throw new Error("Generated Secret requires node, context, namespace, name, and value contracts.");
  }
  for (const [key, contract] of Object.entries(props.values)) {
    if (!key.trim()) throw new Error("Generated Secret keys must not be empty.");
    if (
      contract.kind === "publicLiteral" &&
      (!contract.value.trim() ||
        /(?:password|passwd|token|private[-_]?key|client[-_]?secret|credential)/i.test(
          key,
        ))
    ) {
      throw new Error(
        `Generated Secret ${props.namespace}/${props.name} key ${key} cannot persist sensitive or empty literal material; use a random value contract.`,
      );
    }
    if (
      contract.kind === "random" &&
      (!Number.isInteger(contract.bytes) ||
        contract.bytes < 32 ||
        contract.bytes > 4096 ||
        contract.encoding !== "base64url")
    ) {
      throw new Error(
        `Generated Secret ${props.namespace}/${props.name} key ${key} has an unsafe random value contract.`,
      );
    }
  }
}

function statusCode(cause: unknown): number | undefined {
  if (!cause || typeof cause !== "object") return undefined;
  const direct = Reflect.get(cause, "statusCode") ?? Reflect.get(cause, "code");
  if (typeof direct === "number") return direct;
  const response = Reflect.get(cause, "response");
  if (!response || typeof response !== "object") return undefined;
  const responseStatus = Reflect.get(response, "statusCode");
  return typeof responseStatus === "number" ? responseStatus : undefined;
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}
