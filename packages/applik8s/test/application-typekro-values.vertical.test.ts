// typecast-file-boundary: Tests inspect TypeKro proxy internals and serialized CEL fixtures that intentionally cross static type boundaries.

import { type } from 'arktype';
import { Cel } from 'typekro';
import { describe, expect, test } from 'vitest';
import { app } from '../src/application.js';
import { applicationTypeKroGreaterThan } from '../src/application-typekro-values.js';

describe('application TypeKro value composition', () => {
  test('parenthesizes nested selection expressions before comparison', () => {
    const selected = Cel.expr<number>('schema.spec.profile == "starter" ? 1 : 3');
    const compared = applicationTypeKroGreaterThan(selected as number, 1);
    expect(Reflect.get(compared as unknown as object, 'expression')).toBe('(schema.spec.profile == "starter" ? 1 : 3) > 1');
  });

  test('keeps concrete comparisons concrete', () => {
    expect(applicationTypeKroGreaterThan(3, 1)).toBe(true);
    expect(applicationTypeKroGreaterThan(1, 1)).toBe(false);
  });

  test('offers typed installation string interpolation without exposing CEL', () => {
    const application = app('bounded-name', {
      spec: type({ name: 'string' }),
      status: type({ ready: 'boolean' }),
    });
    const bucket = application.interpolate`${application.installation.spec.name}-media`;
    expect(Reflect.get(bucket as unknown as object, 'expression')).toBe('"" + string(schema.spec.name) + "-media"');
  });
});
