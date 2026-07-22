import type {
  ApplicationContainerRegistryCredentialSecret,
  ApplicationHarborProjectManagement,
} from './application-providers.js';
import type { ResolvedApplicationContainerRegistry } from './container-deployment-plan.js';

export interface ApplicationHarborProjectPreparationRequest {
  readonly context: string;
  readonly endpoint: string;
  readonly project: string;
  readonly registry: string;
  readonly allowPlainHttp: boolean;
  readonly insecure: boolean;
  readonly caFile?: string;
  readonly adminCredentials: ApplicationContainerRegistryCredentialSecret;
  readonly secretNamespace: string;
  readonly policy: Omit<
    ApplicationHarborProjectManagement,
    | 'adminCredentials'
    | 'secretNamespace'
    | 'pushRobotName'
    | 'pushSecretName'
    | 'pullRobotName'
    | 'pullSecretName'
    | 'projectLifecycle'
  >;
  readonly robots: readonly {
    readonly name: string;
    readonly secretName: string;
    readonly access: 'pull' | 'push';
    /** Registry origin encoded into this purpose-scoped dockerconfig Secret. */
    readonly registry: string;
  }[];
}

export interface ApplicationHarborProjectDeletionRequest {
  readonly context: string;
  readonly endpoint: string;
  readonly project: string;
  readonly allowPlainHttp: boolean;
  readonly insecure: boolean;
  readonly caFile?: string;
  readonly adminCredentials: ApplicationContainerRegistryCredentialSecret;
  readonly purgeRepositories: boolean;
  readonly timeoutMs?: number;
  readonly secretNamespace: string;
  readonly robotSecretNames: readonly string[];
}

export interface ApplicationContainerRegistryPreparationRuntime {
  ensureNamespace(context: string, namespace: string): Promise<ApplicationDirectNamespacePreparationReceipt>;
  deleteNamespace(context: string, receipt: ApplicationDirectNamespacePreparationReceipt): Promise<void>;
  reconcileHarborProject(request: ApplicationHarborProjectPreparationRequest): Promise<void>;
  deleteHarborProject(request: ApplicationHarborProjectDeletionRequest): Promise<void>;
}

/**
 * Durable, credential-free evidence for a Namespace needed before the KRO
 * instance exists. A managed Namespace must be deleted only by reconstructing
 * the same TypeKro direct factory and calling deleteInstance(). External
 * Namespaces are observed, never adopted or deleted.
 */
export interface ApplicationDirectNamespacePreparationReceipt {
  readonly apiVersion: 'applik8s.deployment/v1alpha1';
  readonly kind: 'DirectNamespacePreparation';
  readonly namespace: string;
  readonly instanceName: string;
  readonly ownership: 'managed' | 'external';
  /**
   * True only when this preparation invocation created the Namespace. This is
   * intentionally distinct from durable ownership: an existing managed
   * Namespace remains app-owned, but must never be rolled back by a later
   * failed update.
   */
  readonly created?: boolean;
  readonly purpose?: 'container-registry' | 'application-host' | 'application-control-plane' | 'provider-control-plane' | 'identity-infrastructure';
}

export interface ApplicationContainerRegistryPreparationReceipt {
  readonly provider: 'external' | 'managed-harbor';
  readonly project?: string;
  readonly secretNamespace?: string;
  readonly pushSecretName?: string;
  readonly pullSecretName?: string;
  readonly projectDeletion?: Omit<ApplicationHarborProjectDeletionRequest, 'context'>;
  readonly directPreparations?: readonly ApplicationDirectNamespacePreparationReceipt[];
}

/**
 * Prepare provider-owned registry state before any image build. The planner contains Secret
 * coordinates and policy only; credential values remain execution-time concerns of the runtime.
 */
export async function prepareApplicationContainerRegistry(
  resolved: ResolvedApplicationContainerRegistry,
  context: string,
  runtime: ApplicationContainerRegistryPreparationRuntime,
): Promise<ApplicationContainerRegistryPreparationReceipt> {
  const provider = resolved.provider;
  if (provider.kind !== 'harbor-container-registry' || !provider.management) {
    return { provider: 'external' };
  }
  if (!resolved.origin) {
    throw new Error('Managed Harbor ContainerRegistry endpoint did not resolve before preparation.');
  }
  const management = provider.management;
  if (
    provider.pushCredentials.namespace !== management.secretNamespace
    || provider.pullSecret.namespace !== management.secretNamespace
  ) {
    throw new Error('Managed Harbor robot Secrets must be reconciled into management.secretNamespace.');
  }
  const namespacePreparation = await runtime.ensureNamespace(context, management.secretNamespace);
  try {
    await runtime.reconcileHarborProject({
      context,
      endpoint: resolved.origin,
      project: provider.project,
      registry: resolved.origin,
      allowPlainHttp: provider.tls?.plainHttp === true || resolved.origin.startsWith('http://'),
      insecure: provider.tls?.insecure === true,
      ...(provider.tls?.caFile ? { caFile: provider.tls.caFile } : {}),
      adminCredentials: management.adminCredentials,
      secretNamespace: management.secretNamespace,
      policy: {
        ...(management.storageLimitBytes !== undefined ? { storageLimitBytes: management.storageLimitBytes } : {}),
        ...(management.autoScan !== undefined ? { autoScan: management.autoScan } : {}),
        ...(management.autoSbomGeneration !== undefined ? { autoSbomGeneration: management.autoSbomGeneration } : {}),
        ...(management.immutableTags ? { immutableTags: management.immutableTags } : {}),
        ...(management.retention ? { retention: management.retention } : {}),
      },
      robots: [
        {
          name: management.pushRobotName ?? 'applik8s-push',
          secretName: provider.pushCredentials.name,
          access: 'push',
          registry: resolved.origin,
        },
        {
          name: management.pullRobotName ?? 'applik8s-pull',
          secretName: provider.pullSecret.name,
          access: 'pull',
          registry: resolved.pullOrigin ?? resolved.origin,
        },
      ],
    });
  } catch (cause) {
    if (namespacePreparation.ownership === 'managed' && namespacePreparation.created === true) {
      try {
        await runtime.deleteNamespace(context, namespacePreparation);
      } catch (cleanupCause) {
        throw new AggregateError(
          [cause, cleanupCause],
          `Harbor project preparation failed and managed Namespace ${namespacePreparation.namespace} could not be rolled back through TypeKro.`,
        );
      }
    }
    throw cause;
  }
  return {
    provider: 'managed-harbor',
    project: provider.project,
    secretNamespace: management.secretNamespace,
    pushSecretName: provider.pushCredentials.name,
    pullSecretName: provider.pullSecret.name,
    ...(management.projectLifecycle?.deletionPolicy === 'delete'
      ? {
          projectDeletion: {
            endpoint: resolved.origin,
            project: provider.project,
            allowPlainHttp: provider.tls?.plainHttp === true || resolved.origin.startsWith('http://'),
            insecure: provider.tls?.insecure === true,
            ...(provider.tls?.caFile ? { caFile: provider.tls.caFile } : {}),
            adminCredentials: management.adminCredentials,
            purgeRepositories: management.projectLifecycle.purgeRepositories === true,
            ...(management.projectLifecycle.timeoutMs ? { timeoutMs: management.projectLifecycle.timeoutMs } : {}),
            secretNamespace: management.secretNamespace,
            robotSecretNames: [provider.pushCredentials.name, provider.pullSecret.name],
          },
        }
      : {}),
    directPreparations: [namespacePreparation],
  };
}

/** Delete app-owned direct preparation after the KRO instance has finalized. */
export async function deleteApplicationContainerRegistryPreparation(
  receipt: ApplicationContainerRegistryPreparationReceipt,
  context: string,
  runtime: ApplicationContainerRegistryPreparationRuntime,
  options: { readonly preserveNamespaces?: readonly string[] } = {},
): Promise<void> {
  if (receipt.projectDeletion) {
    await runtime.deleteHarborProject({ ...receipt.projectDeletion, context });
  }
  const preserved = new Set(options.preserveNamespaces ?? []);
  for (const preparation of [...(receipt.directPreparations ?? [])].reverse()) {
    if (preparation.ownership === 'managed' && !preserved.has(preparation.namespace)) {
      await runtime.deleteNamespace(context, preparation);
    }
  }
}
