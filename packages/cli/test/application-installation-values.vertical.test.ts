import { describe, expect, it } from 'vitest';

import { resolveApplicationInstallationValues } from '../src/application-installation-values.js';

describe('Application installation TypeKro expression materialization', () => {
  const optionalNamespace = `\${has(schema.spec.providers) && has(schema.spec.providers.webSearch) && has(schema.spec.providers.webSearch.namespace) && dyn(schema.spec.providers.webSearch.namespace) != null ? schema.spec.providers.webSearch.namespace : "search-system"}`;

  it('resolves guarded optional paths when every ancestor is present', () => {
    expect(resolveApplicationInstallationValues(optionalNamespace, {
      providers: { webSearch: { namespace: 'managed-search' } },
    })).toBe('managed-search');
  });

  it('selects the fallback when an optional leaf or parent is absent', () => {
    expect(resolveApplicationInstallationValues(optionalNamespace, {
      providers: { webSearch: {} },
    })).toBe('search-system');
    expect(resolveApplicationInstallationValues(optionalNamespace, {})).toBe('search-system');
  });

  it('preserves has-like text inside fallback data', () => {
    expect(resolveApplicationInstallationValues(
      `\${has(schema.spec.label) ? schema.spec.label : "has(schema.spec.secret)"}`,
      {},
    )).toBe('has(schema.spec.secret)');
  });

  it('leaves unsupported has calls deferred instead of evaluating arbitrary CEL', () => {
    const expression = `\${has(schema.spec.providers.webSearch.namespace + "suffix") ? schema.spec.providers.webSearch.namespace : "search-system"}`;
    expect(resolveApplicationInstallationValues(expression, {
      providers: { webSearch: { namespace: 'managed-search' } },
    })).toBe(expression);
  });

  it('preserves provider qualification and alias identity after selecting a branch', () => {
    expect(resolveApplicationInstallationValues({
      kind: 'application-provider-selection',
      selector: 'schema.spec.profile',
      cases: {
        production: { kind: 'structured-generation-http', endpoint: 'https://ai.example.test' },
      },
      default: { kind: 'structured-generation-deterministic' },
      bindingKind: 'provided',
      aliasOf: 'provider.structured-generation.content',
      qualification: {
        apiVersion: 'applik8s.providerQualification/v1alpha1',
        name: 'content',
      },
    }, { profile: 'production' })).toEqual({
      kind: 'structured-generation-http',
      endpoint: 'https://ai.example.test',
      bindingKind: 'provided',
      aliasOf: 'provider.structured-generation.content',
      qualification: {
        apiVersion: 'applik8s.providerQualification/v1alpha1',
        name: 'content',
      },
    });
  });
});
