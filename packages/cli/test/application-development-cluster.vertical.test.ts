import { describe, expect, test } from 'vitest';
import {
  assertApplicationDevelopmentSharedFilesystem,
} from '../src/application-alchemy-deployment.js';

describe('application development cluster qualification', () => {
  test.each([
    'orbstack',
    'orbstack-personal',
    'docker-desktop',
    'rancher-desktop',
  ])('accepts the maintained shared-filesystem context %s', (context) => {
    expect(() =>
      assertApplicationDevelopmentSharedFilesystem({
        context,
        server: 'https://127.0.0.1:6443',
        environment: {},
      }),
    ).not.toThrow();
  });

  test('does not mistake a local API endpoint for a shared node filesystem', () => {
    expect(() =>
      assertApplicationDevelopmentSharedFilesystem({
        context: 'kind-example',
        server: 'https://127.0.0.1:6443',
        environment: {},
      }),
    ).toThrow(/cannot prove.*shares host paths/u);
  });

  test('allows an explicit acknowledgement for another compatible local cluster', () => {
    expect(() =>
      assertApplicationDevelopmentSharedFilesystem({
        context: 'local-lab',
        server: 'https://127.0.0.1:7443',
        environment: {
          APPLIK8S_DEVELOPMENT_SHARED_FILESYSTEM: '1',
        },
      }),
    ).not.toThrow();
  });
});
