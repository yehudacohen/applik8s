import { Cel } from 'typekro';
import { describe, expect, it } from 'vitest';
import { applicationTypeKroJsonStringArray } from '../src/application-typekro-values.js';

describe('Application TypeKro value lowering', () => {
  it('keeps graph-aware string arrays in one CEL expression', () => {
    const namespace = Cel.expr<string>(
      'schema.spec.profile == "starter" ? "identity-start-system" : "identity-system"',
    );

    const encoded = applicationTypeKroJsonStringArray([
      Cel.expr<string>(
        '"nats://applik8s-events." + string('
          + Reflect.get(namespace, 'expression')
          + ') + ".svc:4222"',
      ),
    ]);

    const expression = celExpression(encoded);
    expect(expression).toBe(
      '"[\\\"" + string("nats://applik8s-events." + string(schema.spec.profile == "starter" ? "identity-start-system" : "identity-system") + ".svc:4222") + "\\\"]"',
    );
    expect(expression).not.toContain('${');
  });

  it('rehydrates complete portable ApplicationGraph markers without treating mixed strings as expressions', () => {
    const encoded = applicationTypeKroJsonStringArray([
      '${schema.spec.events.server}',
    ]);
    expect(celExpression(encoded)).toBe(
      '"[\\\"" + string(schema.spec.events.server) + "\\\"]"',
    );

    expect(
      applicationTypeKroJsonStringArray([
        'prefix-${schema.spec.events.server}',
      ]),
    ).toBe('["prefix-${schema.spec.events.server}"]');
  });

  it('returns ordinary JSON when every endpoint is concrete', () => {
    expect(
      applicationTypeKroJsonStringArray([
        'nats://events-a.messaging.svc:4222',
        'nats://events-b.messaging.svc:4222',
      ]),
    ).toBe(
      '["nats://events-a.messaging.svc:4222","nats://events-b.messaging.svc:4222"]',
    );
  });
});

function celExpression(value: unknown): unknown {
  if (
    value === null
    || (typeof value !== 'object' && typeof value !== 'function')
  ) {
    throw new Error('Expected a graph-aware CEL value.');
  }
  return Reflect.get(value, 'expression');
}
