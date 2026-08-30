import { describe, expect, it } from 'vitest';
import {
  config,
  secret,
} from '../src/index.js';
import {
  applicationConfigurationProvenance,
  applicationConfigurationValueForDigest,
} from '../src/application-configuration.js';

describe('application configuration provenance', () => {
  it('models typed environment configuration without reading process.env', () => {
    const configuration = {
      endpoint: config.env.url('SERVICE_ENDPOINT'),
      port: config.env.integer('SERVICE_PORT', { default: 443 }),
      optionalName: config.env.optional('SERVICE_NAME'),
      credential: secret.env('SERVICE_CREDENTIAL', {
        contract: { version: 'v1', keys: { token: 'token' } },
      }),
    };

    expect(applicationConfigurationProvenance(configuration)).toEqual([
      { kind: 'config', reference: 'SERVICE_ENDPOINT', required: true },
      { kind: 'config', reference: 'SERVICE_NAME', required: false },
      { kind: 'config', reference: 'SERVICE_PORT', required: false },
      { kind: 'secret', reference: 'SERVICE_CREDENTIAL', required: true },
    ]);
    expect(applicationConfigurationValueForDigest(configuration)).toEqual({
      credential: {
        apiVersion: 'applik8s.configurationBinding/v1alpha1',
        contract: { keys: { token: 'token' }, version: 'v1' },
        kind: 'secret',
        reference: 'SERVICE_CREDENTIAL',
        required: true,
        source: 'environment',
      },
      endpoint: {
        apiVersion: 'applik8s.configurationBinding/v1alpha1',
        kind: 'config',
        reference: 'SERVICE_ENDPOINT',
        required: true,
        source: 'environment',
        valueType: 'url',
      },
      optionalName: {
        apiVersion: 'applik8s.configurationBinding/v1alpha1',
        kind: 'config',
        reference: 'SERVICE_NAME',
        required: false,
        source: 'environment',
        valueType: 'string',
      },
      port: {
        apiVersion: 'applik8s.configurationBinding/v1alpha1',
        default: 443,
        kind: 'config',
        reference: 'SERVICE_PORT',
        required: false,
        source: 'environment',
        valueType: 'integer',
      },
    });
  });

  it('fails closed for malformed references and cyclic provider configuration', () => {
    expect(() => config.env('service-port')).toThrow(/valid variable name/u);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => applicationConfigurationValueForDigest(cyclic)).toThrow(/must not contain cycles/u);
    expect(() => applicationConfigurationProvenance(cyclic)).toThrow(/must not contain cycles/u);
  });
});
