import { describe, expect, it } from 'vitest';
import { SmtpNotificationDelivery } from '../src/index';

describe('SMTP notification delivery', () => {
  it('validates production transport configuration before resolving secrets', () => {
    expect(() => SmtpNotificationDelivery.fromSecret({
      host: 'smtp.example.com',
      port: 70_000,
      username: { name: 'smtp', key: 'username' },
      password: { name: 'smtp', key: 'password' },
      sender: { email: 'notifications@example.com' },
      async resolveSecret() {
        throw new Error('must not resolve');
      },
    })).toThrow(/between 1 and 65535/);

    expect(() => SmtpNotificationDelivery.fromSecret({
      host: 'smtp.example.com\r\nlocalhost',
      port: 587,
      username: { name: 'smtp', key: 'username' },
      password: { name: 'smtp', key: 'password' },
      sender: { email: 'notifications@example.com' },
      async resolveSecret() {
        throw new Error('must not resolve');
      },
    })).toThrow(/single-line/);
  });

  it('constructs a live provider without exposing credential values', () => {
    const provider = SmtpNotificationDelivery.fromSecret({
      host: 'smtp.example.com',
      port: 587,
      username: { name: 'smtp', key: 'username' },
      password: { name: 'smtp', key: 'password' },
      sender: { name: 'Example', email: 'notifications@example.com' },
      async resolveSecret() {
        return 'server-only';
      },
    });
    expect(provider).toMatchObject({ provider: 'smtp', kind: 'smtp', mode: 'live' });
    expect(JSON.stringify(provider)).not.toContain('server-only');
  });

  it('rejects a sender that does not match the configured sender policy before resolving credentials', async () => {
    let resolutions = 0;
    const provider = SmtpNotificationDelivery.fromSecret({
      host: 'smtp.example.com',
      port: 587,
      username: { name: 'smtp', key: 'username' },
      password: { name: 'smtp', key: 'password' },
      sender: { name: 'Example', email: 'notifications@example.com' },
      async resolveSecret() {
        resolutions += 1;
        return 'server-only';
      },
    });
    await expect(provider.deliver({
      id: 'notice-1',
      idempotencyKey: 'notice-1',
      recipient: { email: 'builder@example.com' },
      sender: { email: 'attacker@example.com' },
      content: { subject: 'Hello', text: 'Safe' },
    })).rejects.toThrow(/configured sender policy/);
    expect(resolutions).toBe(0);
  });
});
