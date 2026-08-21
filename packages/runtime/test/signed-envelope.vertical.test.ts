import { createHmac } from 'node:crypto';
import {
  createRollingSignedEnvelopeCodec,
  createSignedEnvelopeCodec,
  SignedEnvelopeRuntimeError,
  signedEnvelopeUtf8Key,
  signLegacyCompactHmacJsonForRollingMigration,
  staticSignedEnvelopeKeyProvider,
  verifyLegacyCompactHmacJson,
} from '@applik8s/runtime';
import { describe, expect, it } from 'vitest';

const purpose = 'applik8s.test.cursor/v1';
const issuedAt = 1_800_000_000_000;
const expiresAt = issuedAt + 60_000;
const current = {
  id: 'test-key-2',
  key: signedEnvelopeUtf8Key('test-key-material-current-00000000000000000000000000000000'),
};
const previous = {
  id: 'test-key-1',
  key: signedEnvelopeUtf8Key('test-key-material-previous-000000000000000000000000000000'),
};

function codec(options: {
  readonly now?: number;
  readonly maximumEncodedBytes?: number;
  readonly key?: typeof current;
  readonly previous?: readonly (typeof current)[];
  readonly purpose?: string;
} = {}) {
  return createSignedEnvelopeCodec({
    purpose: options.purpose ?? purpose,
    keys: staticSignedEnvelopeKeyProvider({
      current: options.key ?? current,
      ...(options.previous ? { previous: options.previous } : {}),
    }),
    now: () => options.now ?? issuedAt,
    maximumLifetimeMs: 60_000,
    ...(options.maximumEncodedBytes === undefined
      ? {}
      : { maximumEncodedBytes: options.maximumEncodedBytes }),
    validatePayload(value) {
      if (
        !value
        || typeof value !== 'object'
        || Array.isArray(value)
        || typeof Reflect.get(value, 'cursor') !== 'string'
      ) {
        throw new TypeError('cursor must be a string');
      }
      return value as { readonly cursor: string };
    },
  });
}

describe('portable Signed Envelope v1 runtime', () => {
  it('emits deterministic canonical bytes and verifies its typed payload', async () => {
    const token = await codec().sign(
      { cursor: 'next' },
      { issuedAt, expiresAt },
    );

    expect(token).toBe('eyJhbGdvcml0aG0iOiJITUFDLVNIQS0yNTYiLCJleHBpcmVzQXQiOjE4MDAwMDAwNjAwMDAsImlzc3VlZEF0IjoxODAwMDAwMDAwMDAwLCJrZXlJZCI6InRlc3Qta2V5LTIiLCJwYXlsb2FkIjp7ImN1cnNvciI6Im5leHQifSwicHVycG9zZSI6ImFwcGxpazhzLnRlc3QuY3Vyc29yL3YxIiwidmVyc2lvbiI6ImFwcGxpazhzLnNpZ25lZC1lbnZlbG9wZS92MSJ9.6-8fCWqRwu_T5hINXZVkAcFgrWQ-BWHuLV_QMLUQSAs');
    await expect(codec().verify(token)).resolves.toMatchObject({
      purpose,
      keyId: current.id,
      issuedAt,
      expiresAt,
      payload: { cursor: 'next' },
    });
  });

  it('supports bounded key rotation without changing the purpose', async () => {
    const legacy = await codec({ key: previous }).sign(
      { cursor: 'legacy' },
      { issuedAt, expiresAt },
    );
    await expect(codec({ previous: [previous] }).verify(legacy))
      .resolves.toMatchObject({ keyId: previous.id, payload: { cursor: 'legacy' } });
  });

  it('fails closed for cross-purpose substitution, tampering, truncation, and unknown keys', async () => {
    const token = await codec().sign({ cursor: 'next' }, { issuedAt, expiresAt });
    await expect(codec({ purpose: 'applik8s.other.cursor/v1' }).verify(token))
      .rejects.toMatchObject({ code: 'SIGNED_ENVELOPE_PURPOSE_INVALID' });
    const [body, signature] = token.split('.');
    await expect(codec().verify(`${body}.${signature?.slice(0, -2)}aa`))
      .rejects.toMatchObject({ code: 'SIGNED_ENVELOPE_SIGNATURE_INVALID' });
    await expect(codec().verify(token.slice(0, -8)))
      .rejects.toBeInstanceOf(Error);
    await expect(codec({
      key: { ...current, id: 'unknown-key' },
    }).verify(token)).rejects.toMatchObject({ code: 'SIGNED_ENVELOPE_KEY_UNKNOWN' });
  });

  it('rejects expiry, malformed canonical input, invalid payloads, weak keys, and oversize values', async () => {
    const token = await codec().sign({ cursor: 'next' }, { issuedAt, expiresAt });
    await expect(codec({ now: expiresAt + 1 }).verify(token))
      .rejects.toMatchObject({ code: 'SIGNED_ENVELOPE_EXPIRED' });
    await expect(codec({ maximumEncodedBytes: 512 }).sign(
      { cursor: 'x'.repeat(1_000) },
      { issuedAt, expiresAt },
    ))
      .rejects.toMatchObject({ code: 'SIGNED_ENVELOPE_OVERSIZED' });
    expect(() => signedEnvelopeUtf8Key('weak')).toThrow(SignedEnvelopeRuntimeError);
  });

  it('reads the bounded legacy compact format without exposing a legacy writer', async () => {
    const payload = Buffer.from(JSON.stringify({ cursor: 'legacy' })).toString('base64url');
    const token = `${payload}.${createHmac('sha256', previous.key).update(payload).digest('base64url')}`;
    await expect(verifyLegacyCompactHmacJson(token, {
      key: previous.key,
      maximumEncodedBytes: 512,
      validatePayload(value) {
        if (!value || typeof value !== 'object' || Reflect.get(value, 'cursor') !== 'legacy') {
          throw new TypeError('cursor is invalid');
        }
        return value as { readonly cursor: string };
      },
    })).resolves.toEqual({ cursor: 'legacy' });
    await expect(verifyLegacyCompactHmacJson(`${payload}.invalid`, {
      key: previous.key,
      validatePayload: (value) => value,
    })).rejects.toMatchObject({ code: 'SIGNED_ENVELOPE_SIGNATURE_INVALID' });
  });

  it('centralizes the temporary Release-A legacy writer over canonical v1 bytes', async () => {
    const token = await signLegacyCompactHmacJsonForRollingMigration(
      { z: 2, cursor: 'legacy', a: 1 },
      { key: previous.key, maximumEncodedBytes: 512 },
    );
    const [payload] = token.split('.');
    expect(Buffer.from(payload ?? '', 'base64url').toString('utf8')).toBe(
      '{"a":1,"cursor":"legacy","z":2}',
    );
    await expect(verifyLegacyCompactHmacJson(token, {
      key: previous.key,
      maximumEncodedBytes: 512,
      validatePayload(value) { return value; },
    })).resolves.toEqual({ a: 1, cursor: 'legacy', z: 2 });
  });

  it('coordinates Release-A legacy writes with legacy and v1 reads', async () => {
    interface CursorPayload { readonly cursor: string }
    const rolling = createRollingSignedEnvelopeCodec<CursorPayload, CursorPayload>({
      purpose,
      keys: staticSignedEnvelopeKeyProvider({ current }),
      now: () => issuedAt,
      maximumLifetimeMs: 60_000,
      writer: 'legacy',
      validatePayload(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new TypeError('cursor is invalid');
        }
        const record = value as Record<string, unknown>;
        if (typeof record.cursor !== 'string') {
          throw new TypeError('cursor is invalid');
        }
        return { cursor: record.cursor };
      },
      legacy: {
        key: current.key,
        validatePayload(value) {
          if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new TypeError('legacy cursor is invalid');
          }
          const record = value as Record<string, unknown>;
          if (typeof record.cursor !== 'string') {
            throw new TypeError('legacy cursor is invalid');
          }
          return { cursor: record.cursor };
        },
        toCurrent: (value) => value,
        fromCurrent: (value) => ({ cursor: value.cursor }),
      },
    });
    const legacy = await rolling.sign({ cursor: 'legacy-write' }, { issuedAt, expiresAt });
    await expect(rolling.verify(legacy)).resolves.toEqual({ cursor: 'legacy-write' });

    const v1 = await codec().sign({ cursor: 'v1-read' }, { issuedAt, expiresAt });
    await expect(rolling.verify(v1)).resolves.toEqual({ cursor: 'v1-read' });

    await expect(rolling.sign(
      { cursor: 'overlong' },
      { issuedAt, expiresAt: issuedAt + 60_001 },
    )).rejects.toMatchObject({ code: 'SIGNED_ENVELOPE_LIFETIME_INVALID' });
  });

  it('revalidates legacy adapters against the current payload contract', async () => {
    interface CursorPayload { readonly cursor: string }
    const rolling = createRollingSignedEnvelopeCodec<CursorPayload, { readonly legacy: string }>({
      purpose,
      keys: staticSignedEnvelopeKeyProvider({ current }),
      now: () => issuedAt,
      writer: 'legacy',
      validatePayload(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new TypeError('current cursor is invalid');
        }
        const record = value as Record<string, unknown>;
        if (typeof record.cursor !== 'string') {
          throw new TypeError('current cursor is invalid');
        }
        return { cursor: record.cursor };
      },
      legacy: {
        key: current.key,
        validatePayload(value) {
          if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new TypeError('legacy cursor is invalid');
          }
          const record = value as Record<string, unknown>;
          if (typeof record.legacy !== 'string') {
            throw new TypeError('legacy cursor is invalid');
          }
          return { legacy: record.legacy };
        },
        toCurrent: () => ({ cursor: 42 } as unknown as CursorPayload),
        fromCurrent: (value) => ({ legacy: value.cursor }),
      },
    });
    const legacy = await signLegacyCompactHmacJsonForRollingMigration(
      { legacy: 'cursor' },
      { key: current.key },
    );
    await expect(rolling.verify(legacy)).rejects.toThrow('current cursor is invalid');
  });
});
