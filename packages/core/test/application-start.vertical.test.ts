import { describe, expect, it } from 'vitest';
import {
  applicationStartDefinitionApiVersion,
  type ApplicationStartDefinition,
  validateApplicationStartDefinition,
} from '../src/index.js';

describe('application Start definitions', () => {
  it('accepts a pinned, bounded, provider-neutral generator overlay', () => {
    expect(validateApplicationStartDefinition(startDefinition())).toEqual([]);
  });

  it('rejects duplicate contributions, unpinned upstreams, and escaping files', () => {
    const definition = startDefinition();
    expect(
      validateApplicationStartDefinition({
        ...definition,
        packages: [...definition.packages, definition.packages[0]!],
        generator: {
          ...definition.generator,
          upstream: {
            ...definition.generator.upstream,
            version: 'latest',
          },
          files: ['../private-runtime.ts'],
        },
      }).map((finding) => finding.code),
    ).toEqual([
      'START_DUPLICATE_PACKAGE',
      'START_GENERATOR_UNPINNED',
      'START_GENERATOR_PATH',
    ]);
  });
});

function startDefinition(): ApplicationStartDefinition {
  return {
    apiVersion: applicationStartDefinitionApiVersion,
    name: 'agentic',
    version: '0.7.0',
    compatibility: {
      applik8s: '0.7.0',
      tanstackCli: '0.70.1',
      tanstackStart: '1.168.28',
      tanstackAI: '0.42.0',
      typekro: '0.32.0',
    },
    packages: [
      {
        package: '@applik8s/conversations',
        purpose: 'canonical conversation state',
        dependencyZone: 'authoring',
        required: true,
      },
    ],
    profiles: [
      {
        name: 'starter',
        production: false,
        credentialFree: true,
        description: 'local deterministic providers',
      },
    ],
    routes: [],
    diagnostics: [],
    generator: {
      upstream: {
        package: '@tanstack/cli',
        version: '0.70.1',
        mode: 'start-file-router',
        blank: true,
      },
      maximumApplicationFiles: 12,
      maximumIntegrationLines: 600,
      files: ['src/app.ts'],
    },
  };
}
