// typecast-file-boundary: this bounded local recovery harness validates every
// resource identity before reconciling project-owned TypeKro fixtures.
import {
  KubeConfig,
  KubernetesObjectApi,
  PatchStrategy,
} from '@kubernetes/client-node';
import { type } from 'arktype';
import { kubernetesComposition } from 'typekro';
import {
  prepareHarborRookS3Binding,
} from 'typekro/harbor';
import { namespace } from 'typekro/kubernetes';
import {
  rookCephExternalOperatorSingleNodePlatform,
  rookCephOperatorBootstrap,
  rookCephSingleNodePlatform,
  rookObjectStorageClaim,
} from 'typekro/rook';

const context = process.env.APPLIK8S_E2E_CONTEXT ?? 'orbstack';
if (context !== 'orbstack') {
  throw new Error(
    `Harbor storage recovery is restricted to context "orbstack"; received ${JSON.stringify(context)}.`,
  );
}

const identities = Object.freeze({
  operatorNamespace: 'applik8s-rook-ceph-operator',
  platformControlNamespace: 'applik8s-rook-platform-control',
  platformNamespace: 'applik8s-rook-ceph',
  platformName: 'applik8s-rook',
  objectStoreName: 'applik8s-object-store',
  deviceStorageClassName: 'applik8s-identity-start-ceph-block',
  bucketStorageClassName: 'ceph-bucket-retain',
  claimName: 'harbor-registry',
  bucketName: 'harbor-registry-897a44dc-28f0-4e66-90c1-3038e631d674',
  harborNamespace: 'typekro-harbor-registry',
  harborStorageSecret: 'typekro-harbor-s3',
  endpoint:
    'http://rook-ceph-rgw-applik8s-object-store.applik8s-rook-ceph.svc:80',
});

const kubeConfig = new KubeConfig();
kubeConfig.loadFromDefault();
kubeConfig.setCurrentContext(context);
if (kubeConfig.getCurrentContext() !== context) {
  throw new Error(`Could not select kubeconfig context ${context}.`);
}
const objectApi = kubeConfig.makeApiClient(KubernetesObjectApi);

const operatorFactory = rookCephOperatorBootstrap.factory('direct', {
  namespace: identities.operatorNamespace,
  waitForReady: true,
  timeout: 1_200_000,
  kubeConfig,
});
const controlNamespaceComposition = kubernetesComposition(
  {
    name: 'applik8s-orbstack-rook-platform-control',
    kind: 'Applik8sOrbStackRookPlatformControl',
    spec: type({ name: 'string' }),
    status: type({ ready: 'boolean' }),
  },
  () => {
    namespace({
      id: 'controlNamespace',
      metadata: {
        name: identities.platformControlNamespace,
        labels: { 'applik8s.dev/release-fixture': 'orbstack-rook-platform' },
      },
    });
    return { ready: true };
  },
);
const controlNamespaceFactory = controlNamespaceComposition.factory('direct', {
  namespace: identities.platformControlNamespace,
  waitForReady: true,
  timeout: 120_000,
  kubeConfig,
});
const platformNamespaceComposition = kubernetesComposition(
  {
    name: 'applik8s-orbstack-rook-platform-namespace',
    kind: 'Applik8sOrbStackRookPlatformNamespace',
    spec: type({ name: 'string' }),
    status: type({ ready: 'boolean' }),
  },
  () => {
    namespace({
      id: 'platformNamespace',
      metadata: {
        name: identities.platformNamespace,
        labels: { 'applik8s.dev/release-fixture': 'orbstack-rook-platform' },
      },
    });
    return { ready: true };
  },
);
const platformNamespaceFactory = platformNamespaceComposition.factory('direct', {
  namespace: identities.platformNamespace,
  waitForReady: true,
  timeout: 120_000,
  kubeConfig,
});
const obsoleteOwnedPlatformFactory =
  rookCephSingleNodePlatform.factory('kro', {
    namespace: identities.platformControlNamespace,
    waitForReady: true,
    timeout: 1_200_000,
    kubeConfig,
  });
const platformFactory =
  rookCephExternalOperatorSingleNodePlatform.factory('kro', {
    namespace: identities.platformControlNamespace,
    waitForReady: true,
    timeout: 1_200_000,
    kubeConfig,
  });
const claimFactory = rookObjectStorageClaim.factory('direct', {
  namespace: identities.platformNamespace,
  waitForReady: true,
  timeout: 600_000,
  kubeConfig,
});

try {
  const obsoleteOwnedPlatform = await obsoleteOwnedPlatformFactory.deleteInstance(
    identities.platformName,
  );
  if (obsoleteOwnedPlatform.status !== 'complete') {
    throw new Error(
      `Obsolete owned Rook platform cleanup did not complete: ${JSON.stringify(obsoleteOwnedPlatform)}`,
    );
  }
  const controlNamespace = await controlNamespaceFactory.deploy({
    name: 'control',
  });
  if (controlNamespace.status.ready !== true) {
    throw new Error(
      `Rook platform control namespace did not report ready: ${JSON.stringify(controlNamespace.status)}`,
    );
  }
  const platformNamespace = await platformNamespaceFactory.deploy({
    name: 'namespace',
  });
  if (platformNamespace.status.ready !== true) {
    throw new Error(
      `Rook platform namespace did not report ready: ${JSON.stringify(platformNamespace.status)}`,
    );
  }

  const operator = await operatorFactory.deploy({
    name: `${identities.platformName}-operator`,
    namespace: identities.operatorNamespace,
    version: 'v1.20.2',
    repositoryName: 'rook-release',
    repositoryNamespace: identities.operatorNamespace,
    repositoryNamespaceOwnership: 'external',
    enableOBCWatchOperatorNamespace: true,
    obcProvisionerNamePrefix: identities.operatorNamespace,
    values: {
      allowLoopDevices: true,
      csi: { installCsiOperator: true },
      resources: { requests: { cpu: '100m', memory: '128Mi' } },
    },
  });
  if (
    operator.status.ready !== true
    && !(await isLiveHelmReleaseReady(
      objectApi,
      identities.operatorNamespace,
      `${identities.platformName}-operator`,
    ))
  ) {
    throw new Error(
      `Rook operator recovery did not report ready: ${JSON.stringify(operator.status)}`,
    );
  }

  const platform = await platformFactory.deploy({
    profile: 'single-node-development',
    name: identities.platformName,
    namespace: identities.platformNamespace,
    operatorNamespace: identities.operatorNamespace,
    version: 'v1.20.2',
    repositoryName: 'rook-release',
    repositoryNamespace: identities.platformNamespace,
    repositoryNamespaceOwnership: 'owned',
    bucketProvisionerNamePrefix: identities.operatorNamespace,
    storageClassName: identities.deviceStorageClassName,
    storageSize: '16Gi',
    objectStoreName: identities.objectStoreName,
    bucketStorageClassName: identities.bucketStorageClassName,
  });
  if (platform.status.ready !== true) {
    throw new Error(
      `Rook platform recovery did not report ready: ${JSON.stringify(platform.status)}`,
    );
  }

  const claim = await claimFactory.deploy({
    name: identities.claimName,
    namespace: identities.platformNamespace,
    storageClassName: identities.bucketStorageClassName,
    bucket: { mode: 'fixed', name: identities.bucketName },
  });
  if (claim.status.ready !== true) {
    throw new Error(
      `Harbor ObjectBucketClaim recovery did not report ready: ${JSON.stringify(claim.status)}`,
    );
  }

  const binding = await prepareHarborRookS3Binding({
    sourceNamespace: identities.platformNamespace,
    claimName: identities.claimName,
    targetNamespace: identities.harborNamespace,
    targetSecretName: identities.harborStorageSecret,
    endpointOverride: identities.endpoint,
    regionOverride: 'us-east-1',
    rootDirectory: '/registry',
    secure: false,
    kubeConfig: { context },
  });
  if (
    binding.bucket !== identities.bucketName
    || binding.existingSecret !== identities.harborStorageSecret
  ) {
    throw new Error(
      `Harbor storage binding resolved an unexpected identity: ${JSON.stringify(binding)}`,
    );
  }

  const restartedAt = new Date().toISOString();
  for (const name of ['harbor-core', 'harbor-registry', 'harbor-nginx']) {
    await objectApi.patch(
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name, namespace: identities.harborNamespace },
        spec: {
          template: {
            metadata: {
              annotations: {
                'kubectl.kubernetes.io/restartedAt': restartedAt,
              },
            },
          },
        },
      },
      undefined,
      undefined,
      'applik8s-orbstack-harbor-storage-recovery',
      undefined,
      PatchStrategy.StrategicMergePatch,
    );
  }

  console.log(JSON.stringify({
    fixture: 'applik8s-orbstack-harbor-storage',
    action: 'recovered',
    context,
    platform: {
      namespace: identities.platformNamespace,
      name: identities.platformName,
      endpoint: platform.status.endpoint,
    },
    claim: {
      namespace: identities.platformNamespace,
      name: identities.claimName,
      bucket: binding.bucket,
    },
    harbor: {
      namespace: identities.harborNamespace,
      storageSecret: identities.harborStorageSecret,
    },
  }));
} finally {
  await Promise.all([
    operatorFactory.dispose(),
    obsoleteOwnedPlatformFactory.dispose(),
    controlNamespaceFactory.dispose(),
    platformNamespaceFactory.dispose(),
    platformFactory.dispose(),
    claimFactory.dispose(),
  ]);
}

async function isLiveHelmReleaseReady(
  api: KubernetesObjectApi,
  namespace: string,
  name: string,
): Promise<boolean> {
  const release = await api.read({
    apiVersion: 'helm.toolkit.fluxcd.io/v2',
    kind: 'HelmRelease',
    metadata: { name, namespace },
  });
  const observedRelease = release as unknown as {
    readonly metadata?: { readonly generation?: number };
    readonly status?: { readonly conditions?: readonly Record<string, unknown>[] };
  };
  const generation = observedRelease.metadata?.generation;
  const status = observedRelease.status;
  return status?.conditions?.some((condition) => (
    condition.type === 'Ready'
    && condition.status === 'True'
    && (
      typeof generation !== 'number'
      || condition.observedGeneration === generation
    )
  )) === true;
}
