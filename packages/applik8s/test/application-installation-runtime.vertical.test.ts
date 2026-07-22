import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import {
  applicationInstallationSpecEnvironmentVariable,
  readApplicationInstallationSpec,
} from '../src/application-installation-runtime.js';

describe('Application installation runtime desired state', () => {
  const InstallationSpec = type({
    name: 'string',
    profile: "'starter' | 'dedicated' | 'external'",
    features: { media: 'boolean' },
  });

  it('validates the KRO-projected spec before exposing it to provider adapters', () => {
    const value = readApplicationInstallationSpec(InstallationSpec, {
      APPLIK8S_INSTALLATION_SPEC: JSON.stringify({
        name: 'community',
        profile: 'dedicated',
        features: { media: true },
      }),
    });

    expect(value).toEqual({ name: 'community', profile: 'dedicated', features: { media: true } });
  });

  it('fails closed for absent, malformed, or schema-invalid desired state', () => {
    expect(() => readApplicationInstallationSpec(InstallationSpec, {})).toThrow(applicationInstallationSpecEnvironmentVariable);
    expect(() => readApplicationInstallationSpec(InstallationSpec, { APPLIK8S_INSTALLATION_SPEC: '{' })).toThrow(/valid JSON/);
    expect(() => readApplicationInstallationSpec(InstallationSpec, {
      APPLIK8S_INSTALLATION_SPEC: JSON.stringify({ name: 'community', profile: 'unknown', features: { media: true } }),
    })).toThrow(/does not satisfy/);
  });
});
