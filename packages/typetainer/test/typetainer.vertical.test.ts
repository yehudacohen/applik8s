import { describe, expect, it } from 'vitest';

import { containerArtifact, imageRef, imageRefString } from '../src/index.js';

describe('typetainer container recipes', () => {
  it('parses and formats container image references', () => {
    expect(imageRef('ghcr.io/acme/image-pipeline-operator:dev@sha256:abc')).toEqual({
      registry: 'ghcr.io',
      repository: 'acme/image-pipeline-operator',
      tag: 'dev',
      digest: 'sha256:abc',
    });
    expect(imageRefString({ registry: 'ghcr.io', repository: 'acme/image-pipeline-operator', tag: 'dev' })).toBe('ghcr.io/acme/image-pipeline-operator:dev');
  });

  it('preserves build and publish recipes as neutral container artifacts', () => {
    expect(
      containerArtifact({
        image: { registry: 'ghcr.io', repository: 'acme/image-pipeline-operator', tag: 'dev' },
        baseImage: 'ghcr.io/applik8s/applik8s-operator-host:dev',
        files: [{ source: 'operator-manifest.json', destination: '/etc/applik8s/operator-manifest.json' }],
        build: {
          context: '.',
          dockerfile: 'Dockerfile.applik8s-runtime',
          platforms: ['linux/arm64'],
        },
        publish: { enabled: false },
      })
    ).toEqual({
      image: { registry: 'ghcr.io', repository: 'acme/image-pipeline-operator', tag: 'dev' },
      baseImage: { registry: 'ghcr.io', repository: 'applik8s/applik8s-operator-host', tag: 'dev' },
      files: [{ source: 'operator-manifest.json', destination: '/etc/applik8s/operator-manifest.json' }],
      build: {
        context: '.',
        dockerfile: 'Dockerfile.applik8s-runtime',
        platforms: ['linux/arm64'],
      },
      publish: { enabled: false },
    });
  });
});
