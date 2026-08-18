import { trustedContext, validateTrustedContextValue } from '@applik8s/applik8s';
import { type } from '@applik8s/applik8s/dsl';
import { describe, expect, test } from 'vitest';

describe('trusted context runtime validation', () => {
  test('uses the live ArkType schema at the authoring boundary', () => {
    const OrganizationId = trustedContext('organizationId', { schema: type('string') });

    expect(validateTrustedContextValue(OrganizationId, 'organization-1')).toBe('organization-1');
    expect(() => validateTrustedContextValue(OrganizationId, 42)).toThrow(/failed runtime validation/i);
  });

  test('uses the portable JSON Schema after managed-closure serialization', () => {
    const OrganizationId = trustedContext('organizationId', { schema: type('string') });
    // typecast: this fixture deliberately models the compiler's schema-only serialized trusted-context shape.
    const serialized = {
      ...OrganizationId,
      schema: undefined,
    } as unknown as typeof OrganizationId;

    expect(validateTrustedContextValue(serialized, 'organization-1')).toBe('organization-1');
    expect(() => validateTrustedContextValue(serialized, 42)).toThrow(/failed runtime validation/i);
  });
});
