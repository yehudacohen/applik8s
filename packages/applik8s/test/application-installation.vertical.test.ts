// typecast-file-boundary: Type-level installation tests inspect generic model projections and deliberately construct invalid fixtures for negative coverage.
import { app } from '@applik8s/applik8s';
import { applicationInstallationMetadataProperty } from '@applik8s/core';
import { type } from 'arktype';
import { kubernetesComposition } from 'typekro';
import { configMap } from 'typekro/kubernetes';
import { describe, expect, it } from 'vitest';

describe('installable Application resources', () => {
  it('uses one typed schema for the Application RGD and its public installation model', () => {
    const InstallationSpec = type({
      name: 'string',
      hostname: 'string',
      profile: "'starter' | 'dedicated' | 'external'",
      version: 'string',
      features: { media: 'boolean', analytics: 'boolean' },
    });
    const InstallationStatus = type({
      ready: 'boolean',
      "phase?": "'Installing' | 'Ready' | 'Degraded' | 'Failed'",
      'url?': 'string',
      'observedVersion?': 'string',
      'migrationStatus?': "'Ready' | 'Pending' | 'Failed' | 'NotRequired'",
      'rolloutStatus?': "'Current' | 'Reconciling' | 'Blocked'",
      'backupStatus?': "'Ready' | 'Pending' | 'Failed' | 'NotConfigured'",
      'projectionStatus?': { online: 'string', analytics: 'string' },
      'degradedReasons?': 'string[]',
    });
    const chirp = app('chirp', {
      namespace: 'chirp',
      controlPlaneNamespace: 'chirp-control',
      apiVersion: 'applications.chirp.dev/v1alpha1',
      kind: 'ChirpInstallation',
      spec: InstallationSpec,
      status: InstallationStatus,
    });
    const replicas = chirp.select(chirp.installation.spec.profile, {
      starter: 1,
      dedicated: 3,
      external: 2,
      default: 1,
    });
    // biome-ignore lint/suspicious/noThenProperty: the public conditional DSL intentionally uses then/otherwise branches.
    const mediaMode = chirp.when(chirp.installation.spec.features.media, { then: 'enabled', otherwise: 'disabled' });
    const objectStorageRequired = chirp.any(chirp.installation.spec.features.media, chirp.installation.spec.features.analytics);
    const allOptionalFeatures = chirp.all(chirp.installation.spec.features.media, chirp.installation.spec.features.analytics);
    expect(Reflect.get(replicas as unknown as object, 'expression')).toContain('schema.spec.profile == "starter" ? 1');
    expect(Reflect.get(mediaMode as unknown as object, 'expression')).toBe('schema.spec.features.media ? "enabled" : ("disabled")');
    expect(Reflect.get(objectStorageRequired as unknown as object, 'expression')).toBe('(schema.spec.features.media) || (schema.spec.features.analytics)');
    expect(Reflect.get(allOptionalFeatures as unknown as object, 'expression')).toBe('(schema.spec.features.media) && (schema.spec.features.analytics)');
    chirp.installation.configure((spec, application) => {
      application.infra(() => configMap({
        metadata: { name: 'chirp-installation-inputs', namespace: chirp.installation.spec.name },
        data: { hostname: spec.hostname, version: spec.version },
      }));
    });

    const request = chirp.installation.instance({
      name: 'community',
      namespace: 'chirp-control',
      spec: { name: 'community', hostname: 'social.example.test', profile: 'starter', version: 'sha256:test', features: { media: true, analytics: true } },
    });
    expect(chirp.installation.model.$model).toMatchObject({ name: 'ChirpInstallation', provider: 'kubernetes', native: 'kubernetes-resource' });
    expect(request).toMatchObject({
      apiVersion: 'applications.chirp.dev/v1alpha1',
      kind: 'ChirpInstallation',
      metadata: { name: 'community', namespace: 'chirp-control' },
      spec: { hostname: 'social.example.test', profile: 'starter' },
    });
    expect(chirp.composition.factory('kro').toYaml()).toContain('kind: ResourceGraphDefinition');
    expect(chirp.composition.factory('kro').toYaml()).toContain('kind: ChirpInstallation');
    expect(chirp.composition.factory('kro').toYaml()).toContain('$' + '{schema.spec.hostname}');
    expect(chirp.composition.factory('kro').toYaml()).toContain('namespace: $' + '{schema.spec.name}');
    expect(chirp.composition.factory('kro').toYaml(request.spec)).toContain('kind: ChirpInstallation');
    expect(Reflect.get(chirp.composition, applicationInstallationMetadataProperty)).toMatchObject({
      statusProjection: {
        mode: 'standardApplicationReadiness',
        fields: expect.arrayContaining([
          'ready',
          'phase',
          'url',
          'observedVersion',
          'migrationStatus',
          'rolloutStatus',
          'backupStatus',
          'projectionStatus',
          'degradedReasons',
        ]),
      },
    });
    expect(Reflect.get(chirp.composition, applicationInstallationMetadataProperty)).not.toMatchObject({
      statusProjection: { fields: expect.arrayContaining(['conditions']) },
    });
  });

  it('statically nests a child Application with app.install(...)', () => {
    const worker = app('worker', {
      apiVersion: 'applications.example.dev/v1alpha1',
      kind: 'WorkerInstallation',
      spec: type({ name: 'string', namespace: 'string' }),
      status: type({ ready: 'boolean' }),
    });
    worker.installation.configure((spec, application) => {
      application.infra(() => configMap({
        id: 'workerConfig',
        metadata: { name: 'worker-config', namespace: 'workers' },
        data: { installed: 'true', workerName: spec.name, requestedNamespace: spec.namespace },
      }));
    });
    const fleet = app('fleet', {
      apiVersion: 'applications.example.dev/v1alpha1',
      kind: 'FleetInstallation',
      spec: type({ workerName: 'string', namespace: 'string' }),
      status: type({ ready: 'boolean' }),
    });
    fleet.installation.configure((spec, application) => {
      application.install(worker, {
        name: 'primary-worker',
        spec: { name: spec.workerName, namespace: spec.namespace },
      });
    });

    const yaml = fleet.composition.factory('kro').toYaml();
    const graph = Reflect.get(fleet.composition, '__applik8sApplicationGraph');
    expect(yaml).toContain('kind: ConfigMap');
    expect(yaml).toContain('$' + '{schema.spec.workerName}');
    expect(graph?.nodes).toContainEqual(expect.objectContaining({
      kind: 'installation',
      name: 'primary-worker',
      application: {
        name: 'worker',
        apiVersion: 'applications.example.dev/v1alpha1',
        kind: 'WorkerInstallation',
      },
      materialization: 'nestedTypeKroComposition',
    }));

    const hosted = app('hosted-fleet', {
      apiVersion: 'applications.example.dev/v1alpha1',
      kind: 'HostedFleetInstallation',
      spec: type({}),
      status: type({ ready: 'boolean' }),
    });
    hosted.install(worker, { spec: { name: 'top-level', namespace: 'workers' } });
    expect(hosted.composition.factory('kro').toYaml()).toContain('workerName: top-level');
  });

  it('nests a TypeKro composition through app.infra(...) with a stable graph identity', () => {
    const dependency = kubernetesComposition({
      name: 'identity-dependency',
      kind: 'IdentityDependency',
      spec: type({ name: 'string', namespace: 'string' }),
      status: type({ ready: 'boolean' }),
    }, (spec) => {
      configMap({
        id: 'identityConfig',
        metadata: { name: spec.name, namespace: spec.namespace },
        data: { installed: 'true' },
      });
      return { ready: true };
    });
    const application = app('composition-host', {
      apiVersion: 'applications.example.dev/v1alpha1',
      kind: 'CompositionHost',
      spec: type({ name: 'string', identity: { enabled: 'boolean' } }),
      status: type({ ready: 'boolean' }),
    });
    application.installation.configure((spec, installation) => {
      installation.infra(() => dependency({ name: 'identity', namespace: spec.name }), {
        name: 'identity-platform',
      });
    });

    const yaml = application.composition.factory('kro').toYaml();
    const graph = Reflect.get(application.composition, '__applik8sApplicationGraph');
    expect(yaml).toContain('kind: ConfigMap');
    expect(yaml).toContain('namespace: ${schema.spec.name}');
    expect(graph?.nodes).toContainEqual(expect.objectContaining({
      kind: 'typeKroResource',
      name: 'identity-platform',
      resource: {
        apiVersion: 'typekro.dev/v1alpha1',
        kind: 'NestedComposition',
        name: 'identity-platform',
      },
    }));
  });
});
