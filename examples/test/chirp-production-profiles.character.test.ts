import { describe, expect, it } from 'vitest';
import {
  productionAwsProfile,
  productionKubernetesProfile,
} from '../chirp-start/src/providers';

describe('Chirp v0.9 production assembly profiles', () => {
  it('binds the same semantic capability set to complete AWS and Kubernetes implementation graphs', () => {
    const aws = productionAwsProfile.plan();
    const kubernetes = productionKubernetesProfile.plan();
    const capability = (binding: (typeof aws.bindings)[number]) =>
      `${binding.capability.interface}#${binding.capability.qualifier ?? 'default'}`;

    expect(aws.application).toBe('chirp');
    expect(kubernetes.application).toBe('chirp');
    expect(aws.bindings.map(capability).sort()).toEqual(
      kubernetes.bindings.map(capability).sort(),
    );
    expect(aws.bindings).toHaveLength(26);
    expect(kubernetes.bindings).toHaveLength(26);
    expect(aws.implementations.map(({ identity }) => identity.provider.export)).toEqual(
      expect.arrayContaining([
        'Database.auroraPostgres',
        'OperatorRuntime.distributed',
        'JobRuntime.aws',
        'Scheduler.postgres',
        'Scheduler.eventBridge',
        'ApplicationHost.aws',
        'ObjectStorage.s3',
        'EventLog.kinesis',
        'Analytics.postgres',
        'WorkflowEngine.hatchet',
        'StructuredGeneration.http',
        'IndexStore.valkey',
        'ContainerRegistry.ecr',
        'HttpExposure.aws',
        'Certificate.acm',
        'DnsPublication.route53',
        'Lakehouse.s3Dataset',
        'Lakehouse.athenaQueries',
      ]),
    );
    expect(kubernetes.implementations.map(({ identity }) => identity.provider.export)).toEqual(
      expect.arrayContaining([
        'Database.postgres',
        'OperatorRuntime.kubernetes',
        'JobRuntime.kubernetes',
        'Scheduler.postgres',
        'ApplicationHost.kubernetes',
        'ObjectStorage.rookCeph',
        'EventLog.jetStream',
        'ContainerRegistry.harbor',
        'HttpExposure.kubernetes',
        'Certificate.certManager',
        'DnsPublication.externalDns',
        'Lakehouse.objectStorageDataset',
        'Lakehouse.objectStorageQueries',
      ]),
    );
    expect(JSON.stringify(aws)).not.toContain('AWS_CREDENTIALS=');
    expect(JSON.stringify(kubernetes)).not.toContain('dockerconfigjson":');
    expect(
      kubernetes.implementations.flatMap(({ configurationSources }) =>
        configurationSources.map(({ reference }) => reference)),
    ).not.toContain('APPLICATION_NAMESPACE');
    expect(JSON.stringify(kubernetes)).toContain('${schema.spec.name}');
    expect(JSON.stringify(kubernetes)).not.toContain('CHIRP_HISTORY_');
  });

  it('resolves deterministically without changing Chirp domain source', () => {
    expect(productionAwsProfile.plan()).toEqual(productionAwsProfile.plan());
    expect(productionKubernetesProfile.plan()).toEqual(
      productionKubernetesProfile.plan(),
    );
  });
});
