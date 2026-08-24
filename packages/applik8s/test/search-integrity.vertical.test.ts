import { describe, expect, test } from 'vitest';
import {
  adaptApplicationSearchCanonicalJsonV1,
  applicationSearchCanonicalJsonV1Policy,
  applicationSearchCanonicalJsonV1String,
  applicationSearchCanonicalJsonV1Value,
  applicationSearchDigest,
} from '../src/search-integrity.js';
import { applicationSearchLegacyOffsetDigestV07 } from '../src/search-integrity-legacy-v07.js';

describe('application search canonical values', () => {
  test('preserves retained plain-value bytes and digest independent of property order', () => {
    const first = {
      text: 'hello',
      where: { active: true },
      facets: ['status'],
      orderBy: [],
      limit: 20,
    };
    const second = {
      limit: 20,
      orderBy: [],
      facets: ['status'],
      where: { active: true },
      text: 'hello',
    };
    const retained = '{"facets":["status"],"limit":20,"orderBy":[],"text":"hello","where":{"active":true}}';
    expect(applicationSearchCanonicalJsonV1Policy.name).toBe('application-search-value');
    expect(applicationSearchCanonicalJsonV1String(first)).toBe(retained);
    expect(applicationSearchCanonicalJsonV1String(second)).toBe(retained);
    expect(applicationSearchDigest(first)).toBe(
      '070ecd77e5df17b6e26430e209dff214a1354b214fd699562e58db16d2199902',
    );
  });

  test('normalizes dates once for deterministic, PostgreSQL, and OpenSearch consumers', () => {
    const value = {
      nested: [1, { ok: true }],
      at: new Date('2026-08-24T12:34:56.000Z'),
    };
    expect(adaptApplicationSearchCanonicalJsonV1(value)).toEqual({
      at: '2026-08-24T12:34:56.000Z',
      nested: [1, { ok: true }],
    });
    expect(applicationSearchCanonicalJsonV1String(value)).toBe(
      '{"at":"2026-08-24T12:34:56.000Z","nested":[1,{"ok":true}]}',
    );
    expect(applicationSearchDigest(value)).toBe(
      '027d320e1ead9514bb0d4d19ad58494f1febf4591fabfc270bfb04a6442b3616',
    );
    expect(applicationSearchLegacyOffsetDigestV07({ at: value.at })).toBe(
      'a5a7c1e78c7751903c707c3d7fcf48c795d50b057f2d4d9156cc8e7090c8d3c9',
    );
    expect(applicationSearchDigest({ at: value.at })).toBe(
      '83daa6bbdf377860b38e7a57707a6ca95cf11d8dd73fa228ea20354db8a54949',
    );
  });

  test('fails closed for values that cannot cross every provider boundary', () => {
    class SearchOnlyValue {
      value = 'unsafe';
    }
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => applicationSearchCanonicalJsonV1Value({ missing: undefined }))
      .toThrow(/undefined/);
    expect(() => applicationSearchDigest({ score: Number.NaN }))
      .toThrow(/finite number/);
    expect(() => applicationSearchDigest(new SearchOnlyValue()))
      .toThrow(/cannot represent/);
    expect(() => applicationSearchDigest(cycle))
      .toThrow(/cycle/i);
  });
});
