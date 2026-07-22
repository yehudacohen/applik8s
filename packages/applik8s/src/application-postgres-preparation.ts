import { type } from 'arktype';
import { kubernetesComposition } from 'typekro';
import { cluster, ClusterConfigSchema } from 'typekro/cnpg';

const ApplicationPostgresPreparationStatusSchema = type({
  'phase?': 'string',
  'readyInstances?': 'number.integer >= 0',
});

/**
 * Direct lifecycle boundary for an application-owned CloudNativePG cluster.
 *
 * A retained database cannot be a child of the Application RGD because KRO
 * will delete graph children when the installation is deleted. The deployer
 * applies this composition first and records its TypeKro receipt; the
 * Application graph observes the resulting Cluster through externalRef.
 */
export const applicationPostgresClusterPreparation = kubernetesComposition({
  name: 'applik8s-postgres-cluster-preparation',
  kind: 'ApplicationPostgresClusterPreparation',
  spec: ClusterConfigSchema,
  status: ApplicationPostgresPreparationStatusSchema,
}, (spec) => {
  const database = cluster({
    id: 'cluster',
    name: spec.name,
    namespace: spec.namespace,
    spec: spec.spec,
  });
  return {
    phase: database.status.phase,
    readyInstances: database.status.readyInstances,
  };
});
