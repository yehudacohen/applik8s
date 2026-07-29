import { describe, expect, it } from 'vitest';
import {
  applicationInstanceSpec,
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
