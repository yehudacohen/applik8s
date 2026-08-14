// typecast-file-boundary: The deployment graph is codec-validated before this
// module narrows portable Kubernetes templates into TypeKro's aspect surface.
import type {
  ApplicationDeploymentGraph,
  DeploymentJsonObject,
  DeploymentJsonValue,
} from '@applik8s/deployment-contract';
import type { V1Container, V1PodSpec } from '@kubernetes/client-node';
import {
  aspect,
  hotReload,
  resources,
  type PublicFactoryOptions,
} from 'typekro';
import { applicationDevelopmentWorkspace } from './application-development-workspace.js';
export { applicationDevelopmentGraph } from './application-development-graph.js';

/** Applies the host-mount/watch policy to the one generated ApplicationHost. */
export async function applicationDevelopmentAspects(
  graph: ApplicationDeploymentGraph,
  projectRoot: string,
): Promise<NonNullable<PublicFactoryOptions['aspects']>> {
  const candidate = applicationHostCandidate(graph);
  const podSpec = applicationPodSpec(candidate.template);
  const container = applicationContainer(podSpec);
  const port =
    container.ports?.find((entry) => entry.name === 'http')?.containerPort
    ?? 3000;
  const workspace = await applicationDevelopmentWorkspace(projectRoot);
  const rootMount = workspace.workspaceBacked
    ? '/applik8s-dev-root'
    : '/workspace';
  return [
    aspect
      .on(
        resources,
        hotReload({
          replicas: 1,
          labels: { 'typekro.dev/hot-reload': 'true' },
          containers: [
            {
              ...container,
              image: 'node:22.22.1-bookworm-slim',
              imagePullPolicy: 'IfNotPresent',
              command: [
                'sh',
                '-c',
                [
                  'set -eu',
                  ...workspace.installCommand,
                  `exec npm run dev -- --host 0.0.0.0 --port ${port}`,
                ].join('; '),
              ],
              workingDir: workspace.applicationRoot,
              resources: {
                requests: { cpu: '100m', memory: '256Mi' },
                limits: { cpu: '2', memory: '2Gi' },
              },
              env: [
                ...(container.env ?? []),
                {
                  name: 'TSR_TMP_DIR',
                  value: `${workspace.applicationRoot}/src/.tanstack/tmp`,
                },
              ],
              securityContext: {
                ...container.securityContext,
                readOnlyRootFilesystem: false,
              },
              volumeMounts: [
                ...(container.volumeMounts ?? []),
                { name: 'applik8s-workspace', mountPath: rootMount },
                ...workspace.volumeMounts,
                {
                  name: 'applik8s-linux-node-modules',
                  mountPath: `${rootMount}/node_modules`,
                },
                {
                  name: 'applik8s-bun-cache',
                  mountPath: '/root/.bun/install/cache',
                },
                {
                  name: 'applik8s-npm-cache',
                  mountPath: '/root/.npm',
                },
              ],
            },
          ],
          volumes: [
            ...(podSpec.volumes ?? []),
            { name: 'applik8s-workspace', emptyDir: {} },
            ...workspace.volumes,
            { name: 'applik8s-linux-node-modules', emptyDir: {} },
            { name: 'applik8s-bun-cache', emptyDir: {} },
            { name: 'applik8s-npm-cache', emptyDir: {} },
          ],
        }),
      )
      .where({
        kind: 'Deployment',
        name: candidate.name,
        labels: { 'app.kubernetes.io/component': 'application-host' },
      })
      .expectOne(),
  ];
}

function applicationHostCandidate(graph: ApplicationDeploymentGraph): {
  readonly id: string;
  readonly name: string;
  readonly template: DeploymentJsonObject;
} {
  const root = graph.nodes.find(
    (node) => node.id === 'kubernetes.application',
  );
  if (root?.kind !== 'kubernetesComposition' || !root.spec.materialized) {
    throw new Error(
      'Development deployment requires the compiler-materialized Application composition.',
    );
  }
  const candidates = root.spec.materialized.resources.flatMap((resource) => {
    const id = stringProperty(resource, 'id');
    const template = objectProperty(resource, 'template');
    if (
      !id
      || template?.apiVersion !== 'apps/v1'
      || template.kind !== 'Deployment'
      || nestedString(
        template,
        'metadata',
        'labels',
        'app.kubernetes.io/component',
      ) !== 'application-host'
    ) {
      return [];
    }
    const name = nestedString(template, 'metadata', 'name');
    if (!name) {
      throw new Error(
        `Development ApplicationHost ${id} must have a concrete Kubernetes name.`,
      );
    }
    return [{ id, name, template }];
  });
  if (candidates.length !== 1 || !candidates[0]) {
    throw new Error(
      `Development deployment requires exactly one generated ApplicationHost Deployment; found ${candidates.length}.`,
    );
  }
  return candidates[0];
}

function applicationPodSpec(template: DeploymentJsonObject): V1PodSpec {
  const value = objectProperty(
    objectProperty(objectProperty(template, 'spec'), 'template'),
    'spec',
  );
  if (!value) {
    throw new Error('Development ApplicationHost has no pod spec.');
  }
  // typecast: the value is the pod-spec field of a codec-validated Deployment.
  return value as unknown as V1PodSpec;
}

function applicationContainer(podSpec: V1PodSpec): V1Container {
  const containers = podSpec.containers;
  const matches = containers.filter((value) => value.name === 'application');
  if (matches.length !== 1 || containers.length !== 1) {
    throw new Error(
      `Development ApplicationHost must contain only one application container; found ${containers.length} container(s) and ${matches.length} application match(es).`,
    );
  }
  const container = matches[0];
  if (!container) {
    throw new Error('Development ApplicationHost container selection failed.');
  }
  return container;
}

function nestedString(
  value: DeploymentJsonObject,
  ...path: readonly string[]
): string | undefined {
  let current: DeploymentJsonValue = value;
  for (const key of path) {
    const object = asObject(current);
    if (!object) return undefined;
    current = object[key] ?? null;
  }
  return typeof current === 'string' ? current : undefined;
}

function stringProperty(
  value: DeploymentJsonObject,
  key: string,
): string | undefined {
  return typeof value[key] === 'string' ? value[key] : undefined;
}

function objectProperty(
  value: DeploymentJsonObject | undefined,
  key: string,
): DeploymentJsonObject | undefined {
  return value ? asObject(value[key]) : undefined;
}

function asObject(
  value: DeploymentJsonValue | undefined,
): DeploymentJsonObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    // typecast: the array branch was rejected immediately above.
    ? value as DeploymentJsonObject
    : undefined;
}
