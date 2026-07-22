import { type } from 'arktype';
import { kubernetesComposition } from 'typekro';
import { valkey, ValkeyConfigSchema } from 'typekro/valkey';

const ApplicationValkeyPreparationStatusSchema = type({ ready: 'boolean' });

/**
 * Direct lifecycle boundary for a Hyperspike Valkey cluster.
 *
 * The Hyperspike operator copies labels from its Valkey CR onto controller-owned
 * Services. Keeping the CR outside a KRO ApplySet prevents those Services from
 * inheriting an ApplySet membership label and being pruned as unlisted graph
 * children. The application RGD observes this resource through externalRef.
 */
export const applicationValkeyClusterPreparation = kubernetesComposition({
  name: 'applik8s-valkey-cluster-preparation',
  kind: 'ApplicationValkeyClusterPreparation',
  spec: ValkeyConfigSchema,
  status: ApplicationValkeyPreparationStatusSchema,
}, (spec) => {
  const cluster = valkey({
    id: 'cluster',
    name: spec.name,
    namespace: spec.namespace,
    spec: spec.spec,
  });
  return { ready: cluster.status.ready };
});
