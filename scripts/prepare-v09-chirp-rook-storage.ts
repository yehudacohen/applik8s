// typecast-file-boundary: this bounded local qualification fixture validates
// its exact context and bucket identity before exercising destructive cleanup.
import { KubeConfig } from '@kubernetes/client-node';
import { type } from 'arktype';
import { kubernetesComposition } from 'typekro';
import { namespace } from 'typekro/kubernetes';
import {
  rookBucketStorageClass,
  rookObjectStorageClaim,
} from 'typekro/rook';

const context = process.env.APPLIK8S_E2E_CONTEXT ?? 'orbstack';
if (context !== 'orbstack') {
  throw new Error(
    `The Chirp Rook qualification fixture is restricted to context "orbstack"; received ${JSON.stringify(context)}.`,
  );
}

const identities = Object.freeze({
  className: 'ceph-bucket-delete',
  controlNamespace: 'applik8s-rook-platform-control',
  objectStoreName: 'applik8s-object-store',
  objectStoreNamespace: 'applik8s-rook-ceph',
  operatorNamespace: 'applik8s-rook-ceph-operator',
  resetNamespace: 'applik8s-chirp-bucket-reset',
  resetClaim: 'chirp-media-reset',
  resetBucket: 'chirp-media',
});

const kubeConfig = new KubeConfig();
kubeConfig.loadFromDefault();
kubeConfig.setCurrentContext(context);
if (kubeConfig.getCurrentContext() !== context) {
  throw new Error(`Could not select kubeconfig context ${context}.`);
}

const storageClassComposition = kubernetesComposition(
  {
    name: 'applik8s-v09-chirp-rook-storage',
    kind: 'Applik8sV09ChirpRookStorage',
    spec: type({ name: 'string' }),
    status: type({ ready: 'boolean' }),
  },
  () => {
    rookBucketStorageClass({
      id: 'deleteBucketStorageClass',
      name: identities.className,
      objectStoreName: identities.objectStoreName,
      objectStoreNamespace: identities.objectStoreNamespace,
      provisionerNamePrefix: identities.operatorNamespace,
      reclaimPolicy: 'Delete',
      labels: {
        'applik8s.dev/release-fixture': 'v0.9-chirp',
      },
    });
    return { ready: true };
  },
);

const resetNamespaceComposition = kubernetesComposition(
  {
    name: 'applik8s-v09-chirp-bucket-reset-namespace',
    kind: 'Applik8sV09ChirpBucketResetNamespace',
    spec: type({ name: 'string' }),
    status: type({ ready: 'boolean' }),
  },
  () => {
    namespace({
      id: 'resetNamespace',
      metadata: {
        name: identities.resetNamespace,
        labels: {
          'applik8s.dev/release-fixture': 'v0.9-chirp-bucket-reset',
        },
      },
    });
    return { ready: true };
  },
);

const storageClassFactory = storageClassComposition.factory('direct', {
  namespace: identities.controlNamespace,
  waitForReady: true,
  timeout: 120_000,
  kubeConfig,
});
const resetNamespaceFactory = resetNamespaceComposition.factory('direct', {
  namespace: identities.resetNamespace,
  waitForReady: true,
  timeout: 120_000,
  kubeConfig,
});
const resetClaimFactory = rookObjectStorageClaim.factory('direct', {
  namespace: identities.resetNamespace,
  waitForReady: true,
  timeout: 600_000,
  kubeConfig,
});

try {
  const storageClass = await storageClassFactory.deploy({ name: 'chirp' });
  if (storageClass.status.ready !== true) {
    throw new Error(
      `Chirp delete-bucket StorageClass did not report ready: ${JSON.stringify(storageClass.status)}`,
    );
  }

  const forceBucket = process.argv.find((argument) =>
    argument.startsWith('--force-delete-test-bucket='),
  )?.slice('--force-delete-test-bucket='.length);
  if (forceBucket !== undefined) {
    if (forceBucket !== identities.resetBucket) {
      throw new Error(
        `Refusing to delete bucket ${JSON.stringify(forceBucket)}; this fixture is authorized only for ${JSON.stringify(identities.resetBucket)}.`,
      );
    }
    const resetNamespace = await resetNamespaceFactory.deploy({ name: 'reset' });
    if (resetNamespace.status.ready !== true) {
      throw new Error(
        `Chirp bucket-reset Namespace did not report ready: ${JSON.stringify(resetNamespace.status)}`,
      );
    }
    const claim = await resetClaimFactory.deploy({
      name: identities.resetClaim,
      namespace: identities.resetNamespace,
      storageClassName: identities.className,
      bucket: { mode: 'fixed', name: identities.resetBucket },
    });
    if (claim.status.ready !== true) {
      throw new Error(
        `Chirp bucket-reset claim did not report ready: ${JSON.stringify(claim.status)}`,
      );
    }
    const claimDeletion = await resetClaimFactory.deleteInstance(
      identities.resetClaim,
    );
    if (claimDeletion.status !== 'complete') {
      throw new Error(
        `Chirp bucket-reset claim deletion did not complete: ${JSON.stringify(claimDeletion)}`,
      );
    }
    const namespaceDeletion = await resetNamespaceFactory.deleteInstance(
      'reset',
      { scopes: ['cluster'] },
    );
    if (namespaceDeletion.status !== 'complete') {
      throw new Error(
        `Chirp bucket-reset Namespace deletion did not complete: ${JSON.stringify(namespaceDeletion)}`,
      );
    }
  }

  console.log(JSON.stringify({
    fixture: 'applik8s-v09-chirp-rook-storage',
    action: forceBucket === undefined ? 'prepared' : 'prepared-and-reset-test-bucket',
    context,
    storageClass: identities.className,
    ...(forceBucket === undefined ? {} : { deletedTestBucket: forceBucket }),
  }));
} finally {
  await Promise.all([
    storageClassFactory.dispose(),
    resetNamespaceFactory.dispose(),
    resetClaimFactory.dispose(),
  ]);
}
