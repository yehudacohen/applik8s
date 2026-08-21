import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { nodeConstantTimeTextEqual, nodeKeyedDigestBase64Url, nodeKeyedDigestHex, nodeLegacyHmacBase64Url, nodeLegacyHmacHex } from '../src/node-integrity.js';

describe('Node Runtime Integrity compatibility adapter', () => {
  it('preserves the purpose-separated keyed-digest bytes used by released cursors', () => {
    const key = 'node-integrity-test-key-with-at-least-32-bytes';
    const purpose = 'applik8s.query-cursor.context';
    const value = 'trusted-context-v1';
    expect(nodeKeyedDigestBase64Url({ key, purpose, value })).toBe(
      createHmac('sha256', key)
        .update(`${purpose}\0`)
        .update(value)
        .digest('base64url'),
    );
    expect(nodeKeyedDigestHex({ key, purpose, value })).toBe(
      createHmac('sha256', key)
        .update(`${purpose}\0`)
        .update(value)
        .digest('hex'),
    );
  });

  it('rejects weak keys and empty purposes', () => {
    expect(() => nodeKeyedDigestBase64Url({
      key: 'weak',
      purpose: 'test',
      value: 'value',
    })).toThrow(/256 bits/);
    expect(() => nodeKeyedDigestBase64Url({
      key: 'node-integrity-test-key-with-at-least-32-bytes',
      purpose: '',
      value: 'value',
    })).toThrow(/non-empty/);
  });

  it('centralizes released raw-HMAC compatibility and constant-time text comparison', () => {
    const key = 'node-integrity-test-key-with-at-least-32-bytes';
    const value = 'released-wire-body';
    expect(nodeLegacyHmacBase64Url({ key, value })).toBe(
      createHmac('sha256', key).update(value).digest('base64url'),
    );
    expect(nodeLegacyHmacHex({ key, value })).toBe(
      createHmac('sha256', key).update(value).digest('hex'),
    );
    expect(nodeConstantTimeTextEqual('same', 'same')).toBe(true);
    expect(nodeConstantTimeTextEqual('same', 'different-length')).toBe(false);
  });
});
