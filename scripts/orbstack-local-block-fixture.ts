// typecast-file-boundary: this release-qualification harness validates its
// bounded environment inputs before constructing TypeKro Kubernetes resources.
import {
  CoreV1Api,
  KubeConfig,
  type KubernetesObject,
  KubernetesObjectApi,
} from '@kubernetes/client-node';
import { type } from 'arktype';
import { kubernetesComposition } from 'typekro';
import {
  job,
  namespace,
  persistentVolume,
  storageClass,
} from 'typekro/kubernetes';
import { rookCephOperatorBootstrap } from 'typekro/rook';

const command = process.argv[2];
if (command !== 'prepare' && command !== 'cleanup') {
  throw new Error(
    'Usage: node scripts/orbstack-local-block-fixture.ts <prepare|cleanup>',
  );
}

const context = process.env.APPLIK8S_E2E_CONTEXT ?? 'orbstack';
if (context !== 'orbstack') {
  throw new Error(
    `The local-block qualification fixture is restricted to context "orbstack"; received ${JSON.stringify(context)}.`,
  );
}

const options = Object.freeze({
  name: 'applik8s-identity-start-ceph-block',
  namespace: 'applik8s-v07-storage-fixture',
  nodeName: process.env.APPLIK8S_V07_BLOCK_NODE ?? 'orbstack',
  loopDeviceNumber: positiveInteger(
    process.env.APPLIK8S_V07_BLOCK_LOOP ?? '61',
    'APPLIK8S_V07_BLOCK_LOOP',
  ),
  storageClassName: 'applik8s-identity-start-ceph-block',
  persistentVolumeName: 'applik8s-identity-start-ceph-block-0',
  capacity: '16Gi',
  hostDataDirectory: '/var/lib/applik8s-local-block',
  rookDataDirectory: '/var/lib/rook/applik8s-rook',
  rookClusterName: 'applik8s-rook',
  rookClusterNamespace: 'applik8s-rook-ceph',
  rookOperatorNamespace: 'applik8s-rook-ceph-operator',
  image: 'quay.io/ceph/ceph:v20.2.2',
});

const fixture = createOrbStackLocalBlockFixture(options);
const kubeConfig = new KubeConfig();
kubeConfig.loadFromDefault();
kubeConfig.setCurrentContext(context);
if (kubeConfig.getCurrentContext() !== context) {
  throw new Error(`Could not select kubeconfig context ${context}.`);
}

const prepareFactory = fixture.prepare.factory('direct', {
  namespace: options.namespace,
  waitForReady: true,
  timeout: 180_000,
  kubeConfig,
});
const cleanupFactory = fixture.cleanup.factory('direct', {
  namespace: options.namespace,
  waitForReady: true,
  timeout: 120_000,
  kubeConfig,
});
const retainedRookClusterCleanupFactory = fixture.retainedRookClusterCleanup.factory(
  'direct',
  {
    namespace: options.namespace,
    waitForReady: true,
    timeout: 600_000,
    kubeConfig,
  },
);
const retainedRookOperatorCleanupFactory =
  fixture.retainedRookOperatorCleanup.factory('direct', {
    namespace: options.namespace,
    waitForReady: true,
    timeout: 600_000,
    kubeConfig,
  });
const retainedRookOperatorRecoveryFactory = rookCephOperatorBootstrap.factory(
  'direct',
  {
    namespace: options.rookOperatorNamespace,
    waitForReady: true,
    timeout: 600_000,
    kubeConfig,
  },
);

try {
  if (command === 'prepare') {
    const core = kubeConfig.makeApiClient(CoreV1Api);
    const liveRookCluster = await readOptionalKubernetesObject(
      kubeConfig.makeApiClient(KubernetesObjectApi),
      {
        apiVersion: 'ceph.rook.io/v1',
        kind: 'CephCluster',
        metadata: {
          name: options.rookClusterName,
          namespace: options.rookClusterNamespace,
        },
      },
    );
    const existingVolume = (await core.listPersistentVolume()).items.find(
      (volume) => volume.metadata?.name === options.persistentVolumeName,
    );
    if (liveRookCluster) {
      const profile = liveRookCluster.metadata?.labels?.['typekro.dev/profile'];
      if (profile !== 'single-node-development') {
        throw new Error(
          `Refusing to reuse CephCluster ${options.rookClusterNamespace}/${options.rookClusterName} without the TypeKro single-node-development profile label.`,
        );
      }
      const phase = objectString(liveRookCluster, 'status', 'phase');
      if (phase !== 'Ready') {
        throw new Error(
          `Retained CephCluster ${options.rookClusterNamespace}/${options.rookClusterName} is ${JSON.stringify(phase ?? 'Unknown')}; run the explicit local-block fixture cleanup before preparing it again.`,
        );
      }
      if (existingVolume?.status?.phase !== 'Bound') {
        throw new Error(
          `Ready retained CephCluster ${options.rookClusterNamespace}/${options.rookClusterName} does not own the expected bound PersistentVolume ${options.persistentVolumeName}.`,
        );
      }
      const claim = existingVolume.spec?.claimRef;
      if (claim?.namespace !== options.rookClusterNamespace) {
        throw new Error(
          `Refusing to reuse ${options.persistentVolumeName}: the retained Ceph cluster does not own its claim.`,
        );
      }
      console.log(JSON.stringify({
        fixture: 'applik8s-v07-orbstack-local-block',
        action: 'reused',
        context,
        status: {
          ready: true,
          storageClassName: options.storageClassName,
          persistentVolumeName: options.persistentVolumeName,
          devicePath: fixture.devicePath,
        },
      }));
    } else {
      if (existingVolume) {
      const owner = existingVolume.metadata?.labels?.[
        'applik8s.dev/release-fixture'
      ];
      if (owner !== 'orbstack-local-block') {
        throw new Error(
          `Refusing to repair foreign PersistentVolume ${options.persistentVolumeName}; expected the Applik8s release-fixture label.`,
        );
      }
      const phase = existingVolume.status?.phase;
      if (phase === 'Released' || phase === 'Available') {
        const deletion = await prepareFactory.deleteInstance('fixture', {
          scopes: ['cluster'],
          includeUnscopedResources: true,
        });
        if (deletion.status !== 'complete') {
          throw new Error(
            `${phase} local-block fixture cleanup did not complete: ${JSON.stringify(deletion)}`,
          );
        }
      } else if (phase === 'Bound') {
        const claim = existingVolume.spec?.claimRef;
        throw new Error(
          `Refusing to replace bound local-block fixture ${options.persistentVolumeName}` +
            `${claim?.namespace && claim.name ? ` claimed by ${claim.namespace}/${claim.name}` : ''}.`,
        );
      } else {
        throw new Error(
          `Local-block fixture ${options.persistentVolumeName} is in unsupported phase ${JSON.stringify(phase)}.`,
        );
      }
      }
      const cleaned = await cleanupFactory.deploy({ name: 'cleanup' });
      if (cleaned.status.ready !== true) {
        throw new Error(
          `Local-block preflight cleanup did not report ready: ${JSON.stringify(cleaned.status)}`,
        );
      }
      const cleanupDeletion = await cleanupFactory.deleteInstance('cleanup', {
        scopes: ['cluster'],
        includeUnscopedResources: true,
      });
      if (cleanupDeletion.status !== 'complete') {
        throw new Error(
          `Local-block preflight cleanup graph deletion did not complete: ${JSON.stringify(cleanupDeletion)}`,
        );
      }
      const deployed = await prepareFactory.deploy({ name: 'fixture' });
      console.log(JSON.stringify({
        fixture: 'applik8s-v07-orbstack-local-block',
        action: 'prepared',
        context,
        status: deployed.status,
      }));
    }
  } else {
    const objectApi = kubeConfig.makeApiClient(KubernetesObjectApi);
    const retainedClusterNamespace = await readOptionalKubernetesObject(
      objectApi,
      {
        apiVersion: 'v1',
        kind: 'Namespace',
        metadata: { name: options.rookClusterNamespace, namespace: '' },
      },
    );
    const retainedOperatorNamespace = await readOptionalKubernetesObject(
      objectApi,
      {
        apiVersion: 'v1',
        kind: 'Namespace',
        metadata: { name: options.rookOperatorNamespace, namespace: '' },
      },
    );
    const retainedRookCluster = await readOptionalKubernetesObject(objectApi, {
      apiVersion: 'ceph.rook.io/v1',
      kind: 'CephCluster',
      metadata: {
        name: options.rookClusterName,
        namespace: options.rookClusterNamespace,
      },
    });
    if (retainedRookCluster) {
      const profile =
        retainedRookCluster.metadata?.labels?.['typekro.dev/profile'];
      if (profile !== 'single-node-development') {
        throw new Error(
          `Refusing to prepare deletion of CephCluster ${options.rookClusterNamespace}/${options.rookClusterName} without the TypeKro single-node-development profile label.`,
        );
      }
      const clusterSpec = objectRecord(retainedRookCluster, 'spec') ?? {};
      const cleanupPolicy = objectRecord(clusterSpec, 'cleanupPolicy') ?? {};
      if (cleanupPolicy.confirmation !== 'yes-really-destroy-data') {
        await objectApi.replace({
          ...retainedRookCluster,
          spec: {
            ...clusterSpec,
            cleanupPolicy: {
              ...cleanupPolicy,
              confirmation: 'yes-really-destroy-data',
            },
          },
        });
      }
    }
    let recoveryOperatorDeployed = false;
    if (retainedClusterNamespace && !retainedOperatorNamespace) {
      const recovered = await retainedRookOperatorRecoveryFactory.deploy({
        name: `${options.rookClusterName}-operator`,
        namespace: options.rookOperatorNamespace,
        version: 'v1.20.2',
        repositoryName: 'rook-release',
        repositoryNamespace: options.rookOperatorNamespace,
        repositoryNamespaceOwnership: 'owned',
        enableOBCWatchOperatorNamespace: true,
        obcProvisionerNamePrefix: options.rookOperatorNamespace,
        resources: { requests: { cpu: '100m', memory: '128Mi' } },
        values: { allowLoopDevices: true },
      });
      if (recovered.status.ready !== true) {
        await waitForKubernetesObjectReadyCondition(
          objectApi,
          {
            apiVersion: 'helm.toolkit.fluxcd.io/v2',
            kind: 'HelmRelease',
            metadata: {
              name: `${options.rookClusterName}-operator`,
              namespace: options.rookOperatorNamespace,
            },
          },
          300_000,
        );
      }
      recoveryOperatorDeployed = true;
    }

    if (retainedClusterNamespace?.metadata?.deletionTimestamp) {
      await waitForKubernetesObjectAbsent(
        objectApi,
        {
          apiVersion: 'v1',
          kind: 'Namespace',
          metadata: { name: options.rookClusterNamespace, namespace: '' },
        },
        600_000,
      );
    } else if (retainedClusterNamespace) {
      const retainedCluster = await retainedRookClusterCleanupFactory.deploy({
        name: 'retained-rook-cluster',
      });
      if (retainedCluster.status.ready !== true) {
        throw new Error(
          `Retained Rook cluster cleanup graph did not report ready: ${JSON.stringify(retainedCluster.status)}`,
        );
      }
      const retainedClusterDeletion =
        await retainedRookClusterCleanupFactory.deleteInstance(
          'retained-rook-cluster',
          {
            scopes: ['cluster'],
            includeUnscopedResources: true,
          },
        );
      if (retainedClusterDeletion.status !== 'complete') {
        throw new Error(
          `Retained Rook cluster namespace cleanup did not complete: ${JSON.stringify(retainedClusterDeletion)}`,
        );
      }
    }

    await waitForKubernetesObjectAbsent(
      objectApi,
      {
        apiVersion: 'csi.ceph.io/v1',
        kind: 'ClientProfile',
        metadata: {
          name: options.rookClusterName,
          namespace: options.rookOperatorNamespace,
        },
      },
      300_000,
    );

    if (recoveryOperatorDeployed) {
      const recoveryDeletion =
        await retainedRookOperatorRecoveryFactory.deleteInstance(
          `${options.rookClusterName}-operator`,
          {
            scopes: ['cluster'],
            includeUnscopedResources: true,
          },
        );
      if (recoveryDeletion.status !== 'complete') {
        throw new Error(
          `Recovered Rook operator cleanup did not complete: ${JSON.stringify(recoveryDeletion)}`,
        );
      }
    } else if (retainedOperatorNamespace) {
      const retainedOperator = await retainedRookOperatorCleanupFactory.deploy({
        name: 'retained-rook-operator',
      });
      if (retainedOperator.status.ready !== true) {
        throw new Error(
          `Retained Rook operator cleanup graph did not report ready: ${JSON.stringify(retainedOperator.status)}`,
        );
      }
      const retainedOperatorDeletion =
        await retainedRookOperatorCleanupFactory.deleteInstance(
          'retained-rook-operator',
          {
            scopes: ['cluster'],
            includeUnscopedResources: true,
          },
        );
      if (retainedOperatorDeletion.status !== 'complete') {
        throw new Error(
          `Retained Rook operator namespace cleanup did not complete: ${JSON.stringify(retainedOperatorDeletion)}`,
        );
      }
    }
    const deletion = await prepareFactory.deleteInstance('fixture', {
      scopes: ['cluster'],
      includeUnscopedResources: true,
    });
    if (deletion.status !== 'complete') {
      throw new Error(
        `Local-block resource cleanup did not complete: ${JSON.stringify(deletion)}`,
      );
    }
    const cleaned = await cleanupFactory.deploy({ name: 'cleanup' });
    if (cleaned.status.ready !== true) {
      throw new Error(
        `Local-block host cleanup did not report ready: ${JSON.stringify(cleaned.status)}`,
      );
    }
    const cleanupDeletion = await cleanupFactory.deleteInstance('cleanup', {
      scopes: ['cluster'],
      includeUnscopedResources: true,
    });
    if (cleanupDeletion.status !== 'complete') {
      throw new Error(
        `Local-block cleanup graph deletion did not complete: ${JSON.stringify(cleanupDeletion)}`,
      );
    }
    console.log(JSON.stringify({
      fixture: 'applik8s-v07-orbstack-local-block',
      action: 'cleaned',
      context,
      devicePath: fixture.devicePath,
    }));
  }
} finally {
  await Promise.all([
    prepareFactory.dispose(),
    cleanupFactory.dispose(),
    retainedRookClusterCleanupFactory.dispose(),
    retainedRookOperatorCleanupFactory.dispose(),
    retainedRookOperatorRecoveryFactory.dispose(),
  ]);
}

interface OrbStackLocalBlockFixtureOptions {
  readonly name: string;
  readonly namespace: string;
  readonly nodeName: string;
  readonly loopDeviceNumber: number;
  readonly storageClassName: string;
  readonly persistentVolumeName: string;
  readonly capacity: string;
  readonly hostDataDirectory: string;
  readonly rookDataDirectory: string;
  readonly rookClusterName: string;
  readonly rookClusterNamespace: string;
  readonly rookOperatorNamespace: string;
  readonly image: string;
}

function createOrbStackLocalBlockFixture(
  fixtureOptions: OrbStackLocalBlockFixtureOptions,
) {
  const capacityMatch = /^([1-9][0-9]*)Gi$/.exec(fixtureOptions.capacity);
  if (!capacityMatch?.[1]) {
    throw new Error(
      `OrbStack local-block fixture capacity must be a positive whole Gi value; received ${fixtureOptions.capacity}.`,
    );
  }
  const devicePath = `/dev/loop${fixtureOptions.loopDeviceNumber}`;
  const mountedBackingFile = `/host-data/${fixtureOptions.name}.img`;
  const rookDataDirectoryName = fixtureOptions.rookDataDirectory
    .split('/')
    .filter(Boolean)
    .at(-1);
  if (
    !rookDataDirectoryName
    || fixtureOptions.rookDataDirectory !== `/var/lib/rook/${rookDataDirectoryName}`
  ) {
    throw new Error(
      `OrbStack Rook cleanup must target one direct child of /var/lib/rook; received ${JSON.stringify(fixtureOptions.rookDataDirectory)}.`,
    );
  }
  const mountedRookDataDirectory = `/host-rook/${rookDataDirectoryName}`;
  const backingFileSize = `${capacityMatch[1]}G`;
  const labels = {
    'applik8s.dev/release-fixture': 'orbstack-local-block',
  };

  const prepare = kubernetesComposition(
    {
      name: `${fixtureOptions.name}-prepare`,
      kind: 'Applik8sOrbStackLocalBlockPreparation',
      spec: type({ name: 'string' }),
      status: type({
        ready: 'boolean',
        storageClassName: 'string',
        persistentVolumeName: 'string',
        devicePath: 'string',
      }),
    },
    () => {
      const fixtureNamespace = namespace({
        id: 'fixtureNamespace',
        metadata: {
          name: fixtureOptions.namespace,
          labels,
        },
      });
      const prepareJob = job({
        id: 'prepareJob',
        metadata: {
          name: `${fixtureOptions.name}-prepare`,
          namespace: fixtureOptions.namespace,
          labels,
        },
        spec: {
          backoffLimit: 1,
          template: {
            metadata: { labels },
            spec: {
              nodeName: fixtureOptions.nodeName,
              restartPolicy: 'Never',
              containers: [
                {
                  name: 'prepare',
                  image: fixtureOptions.image,
                  securityContext: { privileged: true, runAsUser: 0 },
                  command: ['/bin/sh', '-ec'],
                  args: [
                    `set -eu
device='${devicePath}'
backing='${mountedBackingFile}'
if [ ! -b "$device" ]; then
  mknod "$device" b 7 '${fixtureOptions.loopDeviceNumber}'
fi
attached="$(losetup -n -O BACK-FILE "$device" 2>/dev/null | xargs || true)"
if [ -n "$attached" ]; then
  case "$attached" in
    *'/${fixtureOptions.name}.img') ;;
    *) echo "refusing to reuse $device attached to $attached" >&2; exit 1 ;;
  esac
else
  truncate -s '${backingFileSize}' "$backing"
  losetup "$device" "$backing"
fi
wipefs --all --force "$device"
dd if=/dev/zero of="$device" bs=1M count=16 conv=fsync
blockdev --rereadpt "$device" || true
udevadm trigger --action=change --subsystem-match=block
udevadm settle --timeout=30
mkdir -p /run/udev/data
find -L /sys/block -name dev -type f | while IFS= read -r dev_file; do
  block_sys_device="\${dev_file%/dev}"
  major_minor="$(cat "$dev_file")"
  udev_record="/run/udev/data/b$major_minor"
  if [ ! -s "$udev_record" ]; then
    temporary_record="$udev_record.applik8s.$$"
    {
      printf 'I:0\\n'
      udevadm info --query=property --path="$block_sys_device" | sed 's/^/E:/'
      printf 'G:systemd\\nQ:systemd\\nV:1\\n'
    } > "$temporary_record"
    chmod 0644 "$temporary_record"
    mv "$temporary_record" "$udev_record"
  fi
  test -s "$udev_record"
done
udev_properties="$(udevadm info --query=property --path='/sys/block/loop${fixtureOptions.loopDeviceNumber}')"
printf '%s\\n' "$udev_properties"
printf '%s\\n' "$udev_properties" | grep -Fx 'DEVNAME=${devicePath}'
test -s '/run/udev/data/b7:${fixtureOptions.loopDeviceNumber}'`,
                  ],
                  volumeMounts: [
                    { name: 'dev', mountPath: '/dev' },
                    { name: 'sys', mountPath: '/sys' },
                    { name: 'udev', mountPath: '/run/udev' },
                    { name: 'data', mountPath: '/host-data' },
                  ],
                },
              ],
              volumes: [
                { name: 'dev', hostPath: { path: '/dev', type: 'Directory' } },
                { name: 'sys', hostPath: { path: '/sys', type: 'Directory' } },
                {
                  name: 'udev',
                  hostPath: { path: '/run/udev', type: 'Directory' },
                },
                {
                  name: 'data',
                  hostPath: {
                    path: fixtureOptions.hostDataDirectory,
                    type: 'DirectoryOrCreate',
                  },
                },
              ],
            },
          },
        },
      });
      prepareJob.dependsOn(fixtureNamespace);
      const blockStorageClass = storageClass({
        id: 'storageClass',
        metadata: {
          name: fixtureOptions.storageClassName,
          labels,
        },
        provisioner: 'kubernetes.io/no-provisioner',
        reclaimPolicy: 'Retain',
        volumeBindingMode: 'WaitForFirstConsumer',
      });
      blockStorageClass.dependsOn(prepareJob);
      const blockVolume = persistentVolume({
        id: 'persistentVolume',
        metadata: {
          name: fixtureOptions.persistentVolumeName,
          labels,
        },
        spec: {
          accessModes: ['ReadWriteOnce'],
          capacity: { storage: fixtureOptions.capacity },
          local: { path: devicePath },
          nodeAffinity: {
            required: {
              nodeSelectorTerms: [
                {
                  matchExpressions: [
                    {
                      key: 'kubernetes.io/hostname',
                      operator: 'In',
                      values: [fixtureOptions.nodeName],
                    },
                  ],
                },
              ],
            },
          },
          persistentVolumeReclaimPolicy: 'Retain',
          storageClassName: fixtureOptions.storageClassName,
          volumeMode: 'Block',
        },
      });
      blockVolume.dependsOn(blockStorageClass);
      return {
        ready: prepareJob.status.succeeded === 1,
        storageClassName: fixtureOptions.storageClassName,
        persistentVolumeName: fixtureOptions.persistentVolumeName,
        devicePath,
      };
    },
  );

  const cleanup = kubernetesComposition(
    {
      name: `${fixtureOptions.name}-cleanup`,
      kind: 'Applik8sOrbStackLocalBlockCleanup',
      spec: type({ name: 'string' }),
      status: type({ ready: 'boolean', devicePath: 'string' }),
    },
    () => {
      const fixtureNamespace = namespace({
        id: 'fixtureNamespace',
        metadata: {
          name: fixtureOptions.namespace,
          labels,
        },
      });
      const cleanupJob = job({
        id: 'cleanupJob',
        metadata: {
          name: `${fixtureOptions.name}-cleanup`,
          namespace: fixtureOptions.namespace,
          labels,
        },
        spec: {
          backoffLimit: 1,
          template: {
            metadata: { labels },
            spec: {
              nodeName: fixtureOptions.nodeName,
              restartPolicy: 'Never',
              containers: [
                {
                  name: 'cleanup',
                  image: fixtureOptions.image,
                  securityContext: { privileged: true, runAsUser: 0 },
                  command: ['/bin/sh', '-ec'],
                  args: [
                    `set -eu
device='${devicePath}'
backing='${mountedBackingFile}'
if losetup "$device" >/dev/null 2>&1; then
  attached="$(losetup -n -O BACK-FILE "$device" | xargs)"
  case "$attached" in
    *'/${fixtureOptions.name}.img') losetup -d "$device" ;;
    *) echo "refusing to detach $device attached to $attached" >&2; exit 1 ;;
  esac
fi
rm -f "$backing"
rm -rf '${mountedRookDataDirectory}'`,
                  ],
                  volumeMounts: [
                    { name: 'dev', mountPath: '/dev' },
                    { name: 'data', mountPath: '/host-data' },
                    { name: 'rook-data', mountPath: '/host-rook' },
                  ],
                },
              ],
              volumes: [
                { name: 'dev', hostPath: { path: '/dev', type: 'Directory' } },
                {
                  name: 'data',
                  hostPath: {
                    path: fixtureOptions.hostDataDirectory,
                    type: 'DirectoryOrCreate',
                  },
                },
                {
                  name: 'rook-data',
                  hostPath: {
                    path: '/var/lib/rook',
                    type: 'DirectoryOrCreate',
                  },
                },
              ],
            },
          },
        },
      });
      cleanupJob.dependsOn(fixtureNamespace);
      return {
        ready: cleanupJob.status.succeeded === 1,
        devicePath,
      };
    },
  );

  const retainedRookClusterCleanup = kubernetesComposition(
    {
      name: `${fixtureOptions.name}-retained-rook-cluster-cleanup`,
      kind: 'Applik8sOrbStackRetainedRookClusterCleanup',
      spec: type({ name: 'string' }),
      status: type({ ready: 'boolean' }),
    },
    () => {
      namespace({
        id: 'clusterNamespace',
        metadata: {
          name: fixtureOptions.rookClusterNamespace,
          labels,
        },
      });
      return { ready: true };
    },
  );

  const retainedRookOperatorCleanup = kubernetesComposition(
    {
      name: `${fixtureOptions.name}-retained-rook-operator-cleanup`,
      kind: 'Applik8sOrbStackRetainedRookOperatorCleanup',
      spec: type({ name: 'string' }),
      status: type({ ready: 'boolean' }),
    },
    () => {
      namespace({
        id: 'operatorNamespace',
        metadata: {
          name: fixtureOptions.rookOperatorNamespace,
          labels,
        },
      });
      return { ready: true };
    },
  );

  return Object.freeze({
    prepare,
    cleanup,
    retainedRookClusterCleanup,
    retainedRookOperatorCleanup,
    devicePath,
  });
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 255) {
    throw new Error(`${name} must be an integer between 1 and 255.`);
  }
  return parsed;
}

async function readOptionalKubernetesObject(
  api: KubernetesObjectApi,
  identity: KubernetesObject & {
    readonly metadata: {
      readonly name: string;
      readonly namespace: string;
    };
  },
): Promise<KubernetesObject | undefined> {
  try {
    return await api.read(identity);
  } catch (error) {
    if (kubernetesErrorStatus(error) === 404) return undefined;
    throw error;
  }
}

async function waitForKubernetesObjectAbsent(
  api: KubernetesObjectApi,
  identity: KubernetesObject & {
    readonly metadata: { readonly name: string; readonly namespace: string };
  },
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await readOptionalKubernetesObject(api, identity))) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(
    `Timed out waiting for ${identity.kind ?? 'resource'} ${identity.metadata.name} to disappear.`,
  );
}

async function waitForKubernetesObjectReadyCondition(
  api: KubernetesObjectApi,
  identity: KubernetesObject & {
    readonly metadata: { readonly name: string; readonly namespace: string };
  },
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const resource = await readOptionalKubernetesObject(api, identity);
    const generation =
      typeof resource?.metadata?.generation === 'number'
        ? resource.metadata.generation
        : 0;
    const conditions = objectArray(resource, 'status', 'conditions');
    const ready = conditions.find(
      (condition) =>
        recordString(condition, 'type') === 'Ready' &&
        recordString(condition, 'status') === 'True' &&
        (recordNumber(condition, 'observedGeneration') ?? 0) >= generation,
    );
    if (ready) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(
    `Timed out waiting for ${identity.kind ?? 'resource'} ${identity.metadata.namespace}/${identity.metadata.name} to report Ready=True for its current generation.`,
  );
}

function kubernetesErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const candidate = error as {
    readonly code?: unknown;
    readonly statusCode?: unknown;
    readonly body?: { readonly code?: unknown };
    readonly response?: { readonly statusCode?: unknown };
  };
  for (
    const value of [
      candidate.code,
      candidate.statusCode,
      candidate.body?.code,
      candidate.response?.statusCode,
    ]
  ) {
    if (typeof value === 'number') return value;
  }
  return undefined;
}

function objectString(
  value: KubernetesObject,
  objectKey: string,
  valueKey: string,
): string | undefined {
  const object = (value as Record<string, unknown>)[objectKey];
  if (!object || typeof object !== 'object' || Array.isArray(object)) {
    return undefined;
  }
  const candidate = (object as Record<string, unknown>)[valueKey];
  return typeof candidate === 'string' ? candidate : undefined;
}

function objectRecord(
  value: unknown,
  key: string,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const candidate = (value as Record<string, unknown>)[key];
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return undefined;
  }
  return candidate as Record<string, unknown>;
}

function objectArray(
  value: KubernetesObject | undefined,
  objectKey: string,
  valueKey: string,
): readonly Record<string, unknown>[] {
  if (!value) return [];
  const object = (value as Record<string, unknown>)[objectKey];
  if (!object || typeof object !== 'object' || Array.isArray(object)) return [];
  const candidate = (object as Record<string, unknown>)[valueKey];
  if (!Array.isArray(candidate)) return [];
  return candidate.filter(
    (entry): entry is Record<string, unknown> =>
      Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry),
  );
}

function recordString(
  value: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const candidate = value[key];
  return typeof candidate === 'string' ? candidate : undefined;
}

function recordNumber(
  value: Readonly<Record<string, unknown>>,
  key: string,
): number | undefined {
  const candidate = value[key];
  return typeof candidate === 'number' ? candidate : undefined;
}
