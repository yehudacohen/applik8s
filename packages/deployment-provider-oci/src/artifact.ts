// typecast-file-boundary: OCI and Alchemy artifact outputs are validated for immutable identity before conversion to deployment-provider records.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as Provider from "alchemy/Provider";
import {
  type Resource as AlchemyResource,
  Resource as defineAlchemyResource,
} from "alchemy/Resource";
import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import {
  buildContainer,
  type ContainerBuildOptions,
  harbor,
  type OciRegistryCredential,
  ociRegistry,
} from "typekro/containers";

interface ApplicationContainerArtifactRegistryTransport {
  readonly registry: string;
  readonly deploymentRegistry?: string;
  readonly dockerConfigPath?: string;
  readonly credentialBinding?: string;
  readonly tls?: {
    readonly caCertificate?: string;
    readonly caFile?: string;
    readonly insecure?: boolean;
    readonly plainHttp?: boolean;
  };
}

export type ApplicationContainerArtifactRegistry =
  | { readonly type: "orbstack" }
  | (ApplicationContainerArtifactRegistryTransport & {
      readonly type: "oci";
      readonly repositoryPrefix?: string;
      readonly deploymentRepositoryPrefix?: string;
    })
  | (ApplicationContainerArtifactRegistryTransport & {
      readonly type: "harbor";
      readonly project: string;
      readonly deploymentProject?: string;
    });

export interface ApplicationContainerArtifactProps {
  readonly deploymentNodeId: string;
  readonly sourceDigest: string;
  readonly context: string;
  readonly dockerfile?: string;
  readonly imageName: string;
  readonly tag?: string;
  readonly existingTagPolicy?: "replace" | "adopt";
  readonly platform?: string;
  readonly platforms?: readonly string[];
  readonly buildArgs?: Readonly<Record<string, string>>;
  readonly target?: string;
  readonly timeout?: number;
  readonly registry: ApplicationContainerArtifactRegistry;
  readonly prerequisites?: readonly unknown[];
}

export interface ApplicationContainerArtifactAttributes {
  readonly deploymentNodeId: string;
  readonly sourceDigest: string;
  readonly immutableReference: string;
  readonly taggedReference: string;
  readonly publishedImmutableReference: string;
  readonly publishedTaggedReference: string;
  readonly repository: string;
  readonly tag: string;
  readonly digest?: string;
  readonly pushed: boolean;
  readonly platforms: readonly string[];
}

type PublicationReferences = Pick<
  ApplicationContainerArtifactAttributes,
  "publishedImmutableReference" | "publishedTaggedReference"
>;
type ApplicationContainerArtifactBuildResult = Omit<
  ApplicationContainerArtifactAttributes,
  keyof PublicationReferences
> &
  Partial<PublicationReferences>;

type ApplicationContainerArtifactResource = AlchemyResource<
  "Applik8s.ContainerArtifact",
  ApplicationContainerArtifactProps,
  ApplicationContainerArtifactAttributes
>;

export const ApplicationContainerArtifact =
  defineAlchemyResource<ApplicationContainerArtifactResource>(
    "Applik8s.ContainerArtifact",
    { defaultRemovalPolicy: "retain" },
  );

export interface ApplicationContainerArtifactProviderOptions {
  /** Provider-wide build ceiling. The safe default is one. */
  readonly maxConcurrentBuilds?: number;
  readonly resolveCredential?: (
    binding: string,
    signal?: AbortSignal,
  ) => Promise<OciRegistryCredential>;
  readonly build?: (
    options: ContainerBuildOptions,
  ) => Promise<ApplicationContainerArtifactBuildResult>;
  readonly localImageExists?: (
    reference: string,
    signal: AbortSignal,
  ) => Promise<boolean>;
  readonly localImageDigest?: (
    reference: string,
    signal: AbortSignal,
  ) => Promise<`sha256:${string}`>;
}

export function applicationContainerArtifactProvider(
  options: ApplicationContainerArtifactProviderOptions = {},
): Layer.Layer<
  Provider.Provider<ApplicationContainerArtifactResource>,
  never,
  never
> {
  const scheduleBuild =
    options.maxConcurrentBuilds === undefined
      ? defaultBuildScheduler
      : createBuildScheduler(options.maxConcurrentBuilds);
  const localImageExists = options.localImageExists ?? inspectLocalDockerImage;
  const localImageDigest = options.localImageDigest ?? inspectLocalDockerImageDigest;
  return Provider.succeed(ApplicationContainerArtifact, {
    version: 3,
    read: ({ output }) =>
      Effect.succeed(output ? completePublicationReferences(output) : output),
    list: () => Effect.succeed([]),
    diff: ({ olds, output }) => {
      if (!output || olds.registry.type !== "orbstack") {
        return Effect.succeed(undefined);
      }
      return Effect.tryPromise({
        try: async (signal): Promise<{ action: "update" } | undefined> =>
          (await localImageExists(output.publishedTaggedReference, signal))
            ? undefined
            : { action: "update" },
        catch: (cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
      });
    },
    reconcile: ({ news }) =>
      Effect.tryPromise({
        try: async (signal) => {
          assertArtifactProps(news);
          return scheduleBuild(signal, async () => {
            if (options.build) {
              const built = await options.build(buildOptions(news, options, signal));
              return projectBuildResult(news, await ensureLocalImmutableReference(news, built, localImageDigest, signal));
            }
            const built = await buildContainer(
              buildOptions(news, options, signal),
            );
            return projectBuildResult(news, await ensureLocalImmutableReference(news, {
              deploymentNodeId: news.deploymentNodeId,
              sourceDigest: news.sourceDigest,
              immutableReference: built.imageUri,
              taggedReference: built.taggedImageUri,
              repository: built.repository,
              tag: built.tag,
              ...(built.digest ? { digest: built.digest } : {}),
              pushed: built.pushed,
              platforms: built.platforms,
            }, localImageDigest, signal));
          });
        },
        catch: (cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
      }),
    delete: () => Effect.void,
  });
}

function createBuildScheduler(limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 64) {
    throw new Error(
      `Container artifact maxConcurrentBuilds must be an integer from 1 through 64; received ${limit}.`,
    );
  }
  let active = 0;
  const waiting: Array<() => void> = [];
  const release = () => {
    active -= 1;
    waiting.shift()?.();
  };
  const acquire = async (signal: AbortSignal): Promise<void> => {
    signal.throwIfAborted();
    if (active < limit) {
      active += 1;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const ready = () => {
        signal.removeEventListener("abort", aborted);
        active += 1;
        resolve();
      };
      const aborted = () => {
        const index = waiting.indexOf(ready);
        if (index >= 0) waiting.splice(index, 1);
        reject(signal.reason ?? new Error("Container build was aborted."));
      };
      waiting.push(ready);
      signal.addEventListener("abort", aborted, { once: true });
    });
  };
  return async <T>(
    signal: AbortSignal,
    operation: () => Promise<T>,
  ): Promise<T> => {
    await acquire(signal);
    try {
      signal.throwIfAborted();
      return await operation();
    } finally {
      release();
    }
  };
}

const defaultBuildScheduler = createBuildScheduler(1);
const execFileAsync = promisify(execFile);

async function inspectLocalDockerImage(
  reference: string,
  signal: AbortSignal,
): Promise<boolean> {
  signal.throwIfAborted();
  try {
    const { stdout } = await execFileAsync(
      "docker",
      ["image", "inspect", "--format={{.Id}}", reference],
      { signal, encoding: "utf8" },
    );
    if (!stdout.trim()) {
      throw new Error(
        `Docker reported success while inspecting local image ${reference}, but returned no image identity.`,
      );
    }
    return true;
  } catch (cause) {
    signal.throwIfAborted();
    const stderr =
      cause && typeof cause === "object" && "stderr" in cause
        ? String(cause.stderr)
        : "";
    if (/^\s*Error response from daemon:\s+No such image:/im.test(stderr)) {
      return false;
    }
    throw new Error(
      `Could not verify local container image ${reference}: ${stderr.trim() || (cause instanceof Error ? cause.message : String(cause))}`,
    );
  }
}

async function inspectLocalDockerImageDigest(
  reference: string,
  signal: AbortSignal,
): Promise<`sha256:${string}`> {
  signal.throwIfAborted();
  try {
    const { stdout } = await execFileAsync(
      "docker",
      ["image", "inspect", "--format={{.Id}}", reference],
      { signal, encoding: "utf8" },
    );
    const digest = stdout.trim();
    if (!/^sha256:[a-f0-9]{64}$/.test(digest)) {
      throw new Error(`Docker returned invalid image identity ${JSON.stringify(digest)}.`);
    }
    return digest as `sha256:${string}`;
  } catch (cause) {
    signal.throwIfAborted();
    const stderr = cause && typeof cause === "object" && "stderr" in cause
      ? String(cause.stderr).trim()
      : "";
    throw new Error(
      `Could not resolve immutable local image identity for ${reference}: ${stderr || (cause instanceof Error ? cause.message : String(cause))}`,
    );
  }
}

async function ensureLocalImmutableReference(
  props: ApplicationContainerArtifactProps,
  built: ApplicationContainerArtifactBuildResult,
  localImageDigest: (reference: string, signal: AbortSignal) => Promise<`sha256:${string}`>,
  signal: AbortSignal,
): Promise<ApplicationContainerArtifactBuildResult> {
  if (props.registry.type !== "orbstack" || built.immutableReference !== built.taggedReference || built.digest !== undefined) {
    return built;
  }
  const digest = await localImageDigest(built.taggedReference, signal);
  return { ...built, immutableReference: digest, digest };
}

function projectBuildResult(
  props: ApplicationContainerArtifactProps,
  built: ApplicationContainerArtifactBuildResult,
): ApplicationContainerArtifactAttributes {
  const complete = completePublicationReferences(built);
  const deploymentRegistry =
    props.registry.type === "orbstack"
      ? undefined
      : props.registry.deploymentRegistry;
  const publishedPrefix =
    props.registry.type === "oci"
      ? props.registry.repositoryPrefix
      : props.registry.type === "harbor"
        ? props.registry.project
        : undefined;
  const deploymentPrefix =
    props.registry.type === "oci"
      ? props.registry.deploymentRepositoryPrefix
      : props.registry.type === "harbor"
        ? props.registry.deploymentProject
        : undefined;
  if (!deploymentRegistry && !deploymentPrefix) return complete;
  const immutableReference = projectImageReference(
    complete.immutableReference,
    deploymentRegistry,
    publishedPrefix,
    deploymentPrefix,
  );
  const taggedReference = projectImageReference(
    complete.taggedReference,
    deploymentRegistry,
    publishedPrefix,
    deploymentPrefix,
  );
  if (
    immutableReference === complete.immutableReference &&
    taggedReference === complete.taggedReference
  ) {
    return complete;
  }
  return {
    ...complete,
    immutableReference,
    taggedReference,
  };
}

function completePublicationReferences(
  built: ApplicationContainerArtifactBuildResult,
): ApplicationContainerArtifactAttributes {
  return {
    ...built,
    publishedImmutableReference:
      built.publishedImmutableReference ?? built.immutableReference,
    publishedTaggedReference:
      built.publishedTaggedReference ?? built.taggedReference,
  };
}

function projectImageReference(
  reference: string,
  deploymentRegistry: string | undefined,
  publishedPrefix: string | undefined,
  deploymentPrefix: string | undefined,
): string {
  const separator = reference.indexOf("/");
  if (separator < 1) {
    throw new Error(
      `Published container reference ${reference} has no registry host.`,
    );
  }
  const publishedHost = reference.slice(0, separator);
  let repositoryAndVersion = reference.slice(separator + 1);
  if (deploymentPrefix && deploymentPrefix !== publishedPrefix) {
    if (!publishedPrefix) {
      throw new Error(
        `Cannot project container repository to ${deploymentPrefix} without a published repository prefix.`,
      );
    }
    const prefix = `${publishedPrefix}/`;
    if (!repositoryAndVersion.startsWith(prefix)) {
      throw new Error(
        `Published container reference ${reference} is not beneath repository prefix ${publishedPrefix}.`,
      );
    }
    repositoryAndVersion = `${deploymentPrefix}/${repositoryAndVersion.slice(prefix.length)}`;
  }
  const deploymentHost = deploymentRegistry
    ? registryHost(deploymentRegistry)
    : publishedHost;
  return `${deploymentHost}/${repositoryAndVersion}`;
}

function registryHost(registry: string): string {
  const normalized = registry.includes("://")
    ? registry
    : `https://${registry}`;
  const url = new URL(normalized);
  if (!url.host || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error(
      `Deployment registry ${registry} must contain only a registry origin.`,
    );
  }
  return url.host;
}

function buildOptions(
  props: ApplicationContainerArtifactProps,
  options: ApplicationContainerArtifactProviderOptions,
  signal: AbortSignal,
): ContainerBuildOptions {
  return {
    context: props.context,
    imageName: props.imageName,
    registry: registryConfig(props.registry, options),
    signal,
    ...(props.dockerfile ? { dockerfile: props.dockerfile } : {}),
    ...(props.tag ? { tag: props.tag } : {}),
    ...(props.existingTagPolicy
      ? { existingTagPolicy: props.existingTagPolicy }
      : {}),
    ...(props.platform ? { platform: props.platform } : {}),
    ...(props.platforms ? { platforms: props.platforms } : {}),
    ...(props.buildArgs ? { buildArgs: { ...props.buildArgs } } : {}),
    ...(props.target ? { target: props.target } : {}),
    ...(props.timeout ? { timeout: props.timeout } : {}),
  };
}

function registryConfig(
  registry: ApplicationContainerArtifactRegistry,
  options: ApplicationContainerArtifactProviderOptions,
): ContainerBuildOptions["registry"] {
  if (registry.type === "orbstack") return { type: "orbstack" };
  const credentialProvider = registry.credentialBinding
    ? async (signal?: AbortSignal) => {
        if (!options.resolveCredential) {
          throw new Error(
            `Container registry credential binding ${registry.credentialBinding} has no runtime resolver.`,
          );
        }
        return options.resolveCredential(
          registry.credentialBinding ?? "",
          signal,
        );
      }
    : undefined;
  const transport = {
    registry: registry.registry,
    ...(registry.dockerConfigPath
      ? { dockerConfigPath: registry.dockerConfigPath }
      : {}),
    ...(credentialProvider ? { credentialProvider } : {}),
    ...(registry.tls ? { tls: registry.tls } : {}),
  };
  return registry.type === "harbor"
    ? harbor({ ...transport, project: registry.project })
    : ociRegistry({
        ...transport,
        ...(registry.repositoryPrefix
          ? { repositoryPrefix: registry.repositoryPrefix }
          : {}),
      });
}

function assertArtifactProps(props: ApplicationContainerArtifactProps): void {
  if (
    !props.deploymentNodeId.trim() ||
    !/^sha256:[a-f0-9]{64}$/.test(props.sourceDigest) ||
    !props.context.trim() ||
    !props.imageName.trim()
  ) {
    throw new Error(
      `Container artifact ${props.deploymentNodeId || "<unnamed>"} has an invalid identity, digest, context, or image name.`,
    );
  }
  for (const [name, value] of Object.entries(props.buildArgs ?? {})) {
    if (typeof value !== "string") {
      throw new Error(
        `Container artifact ${props.deploymentNodeId} build argument ${name} did not resolve to a string.`,
      );
    }
    if (/token|password|secret|credential|private.?key/i.test(name)) {
      throw new Error(
        `Container artifact ${props.deploymentNodeId} build argument ${name} looks sensitive. Build secrets require an ephemeral secret mount, not persisted buildArgs.`,
      );
    }
  }
}
// typecast-file-boundary: OCI and Alchemy artifact outputs are validated for immutable identity before conversion to deployment-provider records.
