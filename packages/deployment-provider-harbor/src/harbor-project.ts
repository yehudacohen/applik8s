import { readFile } from "node:fs/promises";
import * as Provider from "alchemy/Provider";
import {
  type Resource as AlchemyResource,
  Resource as defineAlchemyResource,
} from "alchemy/Resource";
import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import {
  deleteHarborProject,
  createHarborKubernetesStore,
  HarborApiClient,
  reconcileHarborProject,
  type HarborKubernetesStore,
  type HarborProjectPolicy,
} from "typekro/harbor";
import type { OciRegistryCredential } from "typekro/containers";

export interface ApplicationHarborCredentialReference {
  readonly apiVersion: "v1";
  readonly kind: "Secret";
  readonly namespace: string;
  readonly name: string;
  readonly username?: string;
  readonly usernameKey?: string;
  readonly passwordKey?: string;
  readonly dockerConfigJsonKey?: string;
}

export interface ApplicationHarborProjectRobot {
  readonly name: string;
  readonly secretName: string;
  readonly access: "pull" | "push";
  readonly registry: string;
}

export interface ApplicationHarborProjectProps {
  readonly deploymentNodeId: string;
  readonly context: string;
  readonly endpoint: string;
  readonly project: string;
  readonly adminCredentials: ApplicationHarborCredentialReference;
  readonly secretNamespace: string;
  readonly policy: Omit<HarborProjectPolicy, "name">;
  readonly robots: readonly ApplicationHarborProjectRobot[];
  readonly allowPlainHttp?: boolean;
  readonly insecure?: boolean;
  readonly caFile?: string;
  readonly deletionPolicy: "delete" | "retain";
  readonly purgeRepositories?: boolean;
  readonly deletionTimeoutMs?: number;
}

export interface ApplicationHarborProjectAttributes {
  readonly deploymentNodeId: string;
  readonly project: string;
  readonly projectId: number;
  readonly ready: true;
  readonly robotSecretNames: readonly string[];
}

type ApplicationHarborProjectResource = AlchemyResource<
  "Applik8s.HarborProject",
  ApplicationHarborProjectProps,
  ApplicationHarborProjectAttributes
>;

export const ApplicationHarborProject =
  defineAlchemyResource<ApplicationHarborProjectResource>(
    "Applik8s.HarborProject",
    { defaultRemovalPolicy: "retain" },
  );

export interface ApplicationHarborProjectProviderOptions {
  readonly resolveCredential: (
    reference: ApplicationHarborCredentialReference,
    context: string,
    signal?: AbortSignal,
  ) => Promise<OciRegistryCredential>;
}

export function applicationHarborProjectProvider(
  options: ApplicationHarborProjectProviderOptions,
): Layer.Layer<
  Provider.Provider<ApplicationHarborProjectResource>,
  never,
  never
> {
  return Provider.succeed(ApplicationHarborProject, {
    version: 1,
    read: ({ olds, output }) =>
      Effect.tryPromise({
        try: async (signal) =>
          observeApplicationHarborProject(olds, output, options, signal),
        catch: toError,
      }),
    list: () => Effect.succeed([]),
    diff: ({ olds, output }) =>
      Effect.tryPromise({
        try: async (signal): Promise<{ action: "update" } | undefined> =>
          (await observeApplicationHarborProject(
            olds,
            output,
            options,
            signal,
          ))
            ? undefined
            : { action: "update" },
        catch: toError,
      }),
    reconcile: ({ news }) =>
      Effect.tryPromise({
        try: async (signal) => {
          assertHarborProjectProps(news);
          const ca = news.caFile ? await readFile(news.caFile) : undefined;
          const client = applicationHarborClient(
            news,
            options,
            signal,
            ca,
          );
          const robotSecretNames: string[] = [];
          let projectId: number | undefined;
          const groups = groupRobotsByRegistry(news.robots);
          for (const [registry, robots] of groups) {
            const result = await reconcileHarborProject(client, {
              project: { name: news.project, public: false, ...news.policy },
              robots: robots.map(({ registry: _registry, ...robot }) => robot),
              secretNamespace: news.secretNamespace,
              registry,
              kubeConfig: {
                loadFromDefault: true,
                context: news.context,
              },
              signal,
            });
            projectId = result.projectId;
            robotSecretNames.push(
              ...result.robots.map((robot) => robot.secretName),
            );
          }
          if (projectId === undefined) {
            throw new Error(
              `Harbor project ${news.project} did not reconcile any robot group.`,
            );
          }
          return {
            deploymentNodeId: news.deploymentNodeId,
            project: news.project,
            projectId,
            ready: true,
            robotSecretNames: [...new Set(robotSecretNames)].sort(),
          };
        },
        catch: toError,
      }),
    delete: ({ output, olds }) =>
      olds.deletionPolicy !== "delete"
        ? Effect.void
        : Effect.tryPromise({
          try: async (signal) => {
            const ca = olds.caFile ? await readFile(olds.caFile) : undefined;
              const client = applicationHarborClient(
                olds,
                options,
                signal,
                ca,
              );
              await deleteHarborProject(client, olds.project, {
                confirmProjectName: olds.project,
                purgeRepositories: olds.purgeRepositories === true,
                ...(olds.deletionTimeoutMs
                  ? { timeoutMs: olds.deletionTimeoutMs }
                  : {}),
                signal,
                secretNamespace: olds.secretNamespace,
                robotSecretNames: output.robotSecretNames,
                kubeConfig: {
                  loadFromDefault: true,
                  context: olds.context,
                },
              });
            },
            catch: toError,
          }),
  });
}

async function observeApplicationHarborProject(
  props: ApplicationHarborProjectProps,
  output: ApplicationHarborProjectAttributes | undefined,
  options: ApplicationHarborProjectProviderOptions,
  signal: AbortSignal,
  dependencies: {
    readonly client?: HarborApiClient;
    readonly store?: HarborKubernetesStore;
  } = {},
): Promise<ApplicationHarborProjectAttributes | undefined> {
  assertHarborProjectProps(props);
  if (!output) return undefined;
  const ca = !dependencies.client && props.caFile
    ? await readFile(props.caFile)
    : undefined;
  const client =
    dependencies.client ??
    applicationHarborClient(props, options, signal, ca);
  const project = await client.request<{ readonly project_id?: number }>({
    method: "GET",
    path: `/projects/${encodeURIComponent(props.project)}`,
    signal,
  }, [200, 404]);
  if (project.status === 404) return undefined;

  const store =
    dependencies.store ??
    createHarborKubernetesStore({
      loadFromDefault: true,
      context: props.context,
    });
  for (const secretName of new Set(props.robots.map((robot) => robot.secretName))) {
    if (!(await store.readSecret(props.secretNamespace, secretName))) {
      return undefined;
    }
  }

  return {
    ...output,
    projectId: project.body?.project_id ?? output.projectId,
    ready: true,
    robotSecretNames: [...new Set(props.robots.map((robot) => robot.secretName))].sort(),
  };
}

function applicationHarborClient(
  props: ApplicationHarborProjectProps,
  options: ApplicationHarborProjectProviderOptions,
  signal: AbortSignal,
  ca: string | Buffer | undefined,
): HarborApiClient {
  return new HarborApiClient({
    endpoint: props.endpoint,
    credentialProvider: () =>
      options.resolveCredential(
        props.adminCredentials,
        props.context,
        signal,
      ),
    allowPlainHttp: props.allowPlainHttp === true,
    rejectUnauthorized: props.insecure !== true,
    ...(ca ? { ca } : {}),
  });
}

/** Internal test hook for live Harbor drift observation. */
export const observeApplicationHarborProjectForTest =
  observeApplicationHarborProject;

function groupRobotsByRegistry(
  robots: readonly ApplicationHarborProjectRobot[],
): ReadonlyMap<string, readonly ApplicationHarborProjectRobot[]> {
  const groups = new Map<string, ApplicationHarborProjectRobot[]>();
  for (const robot of robots) {
    const group = groups.get(robot.registry) ?? [];
    group.push(robot);
    groups.set(robot.registry, group);
  }
  return groups;
}

function assertHarborProjectProps(
  props: ApplicationHarborProjectProps,
): void {
  if (
    !props.deploymentNodeId.trim() ||
    !props.context.trim() ||
    !props.endpoint.trim() ||
    !props.project.trim() ||
    !props.secretNamespace.trim() ||
    props.robots.length === 0
  ) {
    throw new Error(
      `Harbor project ${props.deploymentNodeId || "<unnamed>"} has an invalid identity, endpoint, project, namespace, or robot set.`,
    );
  }
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}
