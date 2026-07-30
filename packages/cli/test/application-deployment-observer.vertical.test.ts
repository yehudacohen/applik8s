import { describe, expect, it } from 'vitest';
import {
  applicationInstanceSpec,
  kubernetesStatusCode,
  type ObservedApplicationInstance,
} from '../src/application-deployment-observer.js';

const instance: ObservedApplicationInstance = {
  apiVersion: 'testing.applik8s.dev/v1alpha1',
  kind: 'ExampleApplication',
  namespace: 'control',
  name: 'example',
};

describe('application deployment observation', () => {
  it('projects a JSON installation spec from the exact live object', () => {
    expect(
      applicationInstanceSpec(
        {
          metadata: { name: 'example', namespace: 'control' },
          spec: {
            profile: 'starter',
            providers: { database: { secretName: 'database' } },
          },
        },
        instance,
      ),
    ).toEqual({
      profile: 'starter',
      providers: { database: { secretName: 'database' } },
    });
  });

  it('recognizes client-node Kubernetes status errors across supported shapes', () => {
    expect(kubernetesStatusCode({ statusCode: 404 })).toBe(404);
    expect(kubernetesStatusCode({ response: { status: 403 } })).toBe(403);
    expect(kubernetesStatusCode({
      body: JSON.stringify({
        kind: 'Status',
        reason: 'NotFound',
        code: 404,
      }),
    })).toBe(404);
    expect(kubernetesStatusCode(new Error(
      'HTTP-Code: 404\nMessage: Unknown API Status Code!',
    ))).toBe(404);
    expect(kubernetesStatusCode(new Error('socket closed'))).toBeUndefined();
  });

  it('fails closed for absent and non-JSON live installation state', () => {
    expect(() => applicationInstanceSpec({}, instance)).toThrow(
      'has no JSON object spec',
    );
    expect(() =>
      applicationInstanceSpec(
        { spec: { profile: 'starter', invalid: undefined } },
        instance,
      ),
    ).toThrow('contains a non-JSON value');
    expect(() =>
      applicationInstanceSpec(
        { spec: { profile: 'starter', invalid: Number.POSITIVE_INFINITY } },
        instance,
      ),
    ).toThrow('non-finite number');
    expect(() =>
      applicationInstanceSpec(
        { spec: { profile: 'starter', invalid: new Date(0) } },
        instance,
      ),
    ).toThrow('non-JSON object');
  });
});
