import type { ApplicationModelSnapshot } from '@applik8s/applik8s';
import { describe, expect, it } from 'vitest';
import {
  type ApplicationNotificationDeliveryInput,
  createApplicationNotificationRequestCallable,
  LocalNotificationDelivery,
  normalizeApplicationNotification,
} from '../src/index';
import { applicationNotificationRequests } from '../src/schema';

type NotificationRequestValue =
  typeof applicationNotificationRequests.$inferSelect;
type NotificationRequestInput =
  typeof applicationNotificationRequests.$inferInsert;

describe('application notification delivery', () => {
  it('captures a deterministic idempotent Starter notification', async () => {
    const delivery = LocalNotificationDelivery.inspectable({
      clock: () => new Date('2026-08-08T12:00:00.000Z'),
    });
    // typecast: retain literal fixture values so idempotent delivery is checked with one immutable input contract.
    const input = {
      id: 'invite-1',
      idempotencyKey: 'invite-1:created',
      recipient: { email: ' Builder@Example.COM ' },
      content: { subject: 'You are invited', text: 'Open the invitation.' },
      template: { id: 'workspace-invitation', version: 'v1' },
    } as const;

    const first = await delivery.deliver(input);
    const repeated = await delivery.deliver(input);

    expect(repeated).toEqual(first);
    expect(first).toMatchObject({
      provider: 'local',
      state: 'queued',
      observedAt: '2026-08-08T12:00:00.000Z',
    });
    expect(delivery.inspect()).toEqual([
      expect.objectContaining({
        input: expect.objectContaining({
          recipient: { email: 'builder@example.com' },
        }),
      }),
    ]);
  });

  it('coalesces concurrent idempotent attempts and enforces bounded recipient rates', async () => {
    let now = new Date('2026-08-08T12:00:00.000Z');
    const delivery = LocalNotificationDelivery.inspectable({
      clock: () => now,
      rateLimits: { windowMs: 60_000, maxDeliveries: 2, maxPerRecipient: 1 },
    });
    const first: ApplicationNotificationDeliveryInput = {
      id: 'notice-1',
      idempotencyKey: 'notice-1',
      recipient: { email: 'builder@example.com' },
      content: { subject: 'Hello', text: 'One' },
    };
    const [left, right] = await Promise.all([
      delivery.deliver(first),
      delivery.deliver(first),
    ]);
    expect(left).toEqual(right);
    expect(delivery.inspect()).toHaveLength(1);
    await expect(delivery.deliver({
      ...first,
      id: 'notice-2',
      idempotencyKey: 'notice-2',
      content: { subject: 'Hello', text: 'Two' },
    })).rejects.toThrow(/recipient .* rate limit/);
    now = new Date('2026-08-08T12:01:01.000Z');
    await expect(delivery.deliver({
      ...first,
      id: 'notice-3',
      idempotencyKey: 'notice-3',
      content: { subject: 'Hello', text: 'Three' },
    })).resolves.toMatchObject({ state: 'queued' });
  });

  it('fails closed when an idempotency key is reused with different content', async () => {
    const delivery = LocalNotificationDelivery.inspectable();
    // typecast: retain literal fixture values while deriving the conflicting notification below.
    const base = {
      id: 'invite-1',
      idempotencyKey: 'invite-1:created',
      recipient: { email: 'builder@example.com' },
      content: { subject: 'You are invited', text: 'Open the invitation.' },
    } as const;
    await delivery.deliver(base);
    await expect(delivery.deliver({
      ...base,
      content: { ...base.content, text: 'Different content.' },
    })).rejects.toThrow(/reused with different content/);
  });

  it('rejects header injection, invalid addresses, oversized tags, and empty bodies', () => {
    expect(() => normalizeApplicationNotification({
      id: 'notice',
      idempotencyKey: 'notice-1',
      recipient: { email: 'builder@example.com' },
      content: { subject: 'Hello\r\nBcc: attacker@example.com', text: 'Safe' },
    })).toThrow(/header-safe/);
    expect(() => normalizeApplicationNotification({
      id: 'notice',
      idempotencyKey: 'notice-1',
      recipient: { email: 'not-an-address' },
      content: { subject: 'Hello', text: 'Safe' },
    })).toThrow(/email is invalid/);
    expect(() => normalizeApplicationNotification({
      id: 'notice',
      idempotencyKey: 'notice-1',
      recipient: { email: 'builder@example.com' },
      content: { subject: 'Hello', text: '' },
    })).toThrow(/non-empty/);
    expect(() => normalizeApplicationNotification({
      id: 'notice',
      idempotencyKey: 'notice-1',
      recipient: { email: 'builder@example.com' },
      content: { subject: 'Hello', text: 'Safe' },
      tags: Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`tag-${index}`, 'value'])),
    })).toThrow(/at most 32 tags/);
  });

  it('hydrates the maintained request callable across find, create, and idempotent replay', async () => {
    const stored: Array<ApplicationModelSnapshot<NotificationRequestValue>> = [];
    let createInput: NotificationRequestInput | undefined;
    const request = createApplicationNotificationRequestCallable({
      NotificationRequest: {
        async find(options) {
          return stored.filter(
            row => row.value.idempotencyKey === options.where?.idempotencyKey,
          );
        },
        async create(input) {
          createInput = input;
          const value: NotificationRequestValue = {
            ...input,
            state: 'pending',
            attempts: 0,
            acceptedAt: null,
            createdAt: '2026-08-08T12:00:00.000Z',
            html: input.html ?? null,
            lastError: null,
            provider: null,
            providerMessageId: null,
            recipientName: input.recipientName ?? null,
            replyToEmail: input.replyToEmail ?? null,
            replyToName: input.replyToName ?? null,
            senderEmail: input.senderEmail ?? null,
            senderName: input.senderName ?? null,
            tags: input.tags ?? {},
            templateId: input.templateId ?? null,
            templateVersion: input.templateVersion ?? null,
            updatedAt: '2026-08-08T12:00:00.000Z',
          };
          const created = { identity: input.id, value };
          stored.push(created);
          return created;
        },
      },
    });
    const input: ApplicationNotificationDeliveryInput = {
      id: 'workspace-invitation:invite-1',
      idempotencyKey: 'workspace-invitation:invite-1:created',
      recipient: { email: 'Builder@Example.com' },
      content: { subject: 'You are invited', text: 'Open the invitation.' },
      template: { id: 'workspace-invitation', version: 'v1' },
    };

    const first = await request(input);
    const replay = await request(input);

    expect(first).toEqual(replay);
    expect(stored).toHaveLength(1);
    expect(createInput).toBeDefined();
    expect(
      Object.entries(createInput ?? {}).filter(([, value]) => value === undefined),
    ).toEqual([]);
    expect(first).toMatchObject({
      identity: input.id,
      value: {
        idempotencyKey: input.idempotencyKey,
        recipientEmail: 'builder@example.com',
        state: 'pending',
      },
    });
    await expect(request({
      ...input,
      content: { ...input.content, text: 'Conflicting content.' },
    })).rejects.toThrow(/reused with different content/);
  });
});
