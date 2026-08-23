import { createHash } from 'node:crypto';
import type {
  ApplicationRelationalModel,
  DrizzleApplicationModelFacet,
  KubernetesApplicationBuilder,
} from '@applik8s/applik8s';
import {
  defineApplicationProvider,
  module,
} from '@applik8s/applik8s';
import {
  bindApplicationCallableDependencies,
  bindApplicationProviderDependencies,
} from '@applik8s/applik8s/internal/provider-runtime';
import type { AnyPgTable } from 'drizzle-orm/pg-core';
import {
  applicationNotificationRequests,
  applicationNotificationSchema,
} from './schema.js';

export * from './schema.js';

export interface ApplicationNotificationAddress {
  readonly email: string;
  readonly name?: string;
}

export interface ApplicationNotificationContent {
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
}

export interface ApplicationNotificationTemplateReference {
  readonly id: string;
  readonly version: string;
}

/**
 * Fully rendered server-side delivery intent. Templates and recipient policy
 * remain application-owned; adapters receive no browser/session authority.
 */
export interface ApplicationNotificationDeliveryInput {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly recipient: ApplicationNotificationAddress;
  readonly sender?: ApplicationNotificationAddress;
  readonly replyTo?: ApplicationNotificationAddress;
  readonly content: ApplicationNotificationContent;
  readonly template?: ApplicationNotificationTemplateReference;
  readonly tags?: Readonly<Record<string, string>>;
}

export interface ApplicationNotificationDeliveryReceipt {
  readonly provider: string;
  readonly messageId: string;
  readonly idempotencyKey: string;
  /** Provider observation, not proof that a human read the notification. */
  readonly state: 'queued' | 'delivered' | 'failed' | 'unknown';
  readonly observedAt: string;
}

export interface ApplicationNotificationRateLimits {
  /** Sliding observation window. */
  readonly windowMs: number;
  /** Maximum new provider attempts in the window for this provider process. */
  readonly maxDeliveries: number;
  /** Maximum new provider attempts for one normalized recipient in the window. */
  readonly maxPerRecipient: number;
}

export interface ApplicationNotificationDeliveryGate {
  deliver(
    input: ApplicationNotificationDeliveryInput,
    send: (
      normalized: ApplicationNotificationDeliveryInput,
    ) => Promise<ApplicationNotificationDeliveryReceipt>,
  ): Promise<ApplicationNotificationDeliveryReceipt>;
}

export interface ApplicationNotificationDeliveryProvider {
  readonly provider: string;
  readonly kind: string;
  readonly mode: 'inspectable' | 'live';
  deliver(
    input: ApplicationNotificationDeliveryInput,
  ): Promise<ApplicationNotificationDeliveryReceipt>;
}

export class ApplicationNotificationDeliveryError extends Error {
  readonly outcome: 'failed' | 'unknown';

  constructor(
    outcome: 'failed' | 'unknown',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ApplicationNotificationDeliveryError';
    this.outcome = outcome;
  }
}

export const NotificationDelivery =
  defineApplicationProvider<ApplicationNotificationDeliveryProvider>({
    interface: 'NotificationDelivery',
    version: 'v1alpha1',
    description:
      'Provider-neutral server-side delivery for rendered application notifications.',
    requirements: [
      'delivery is idempotent for one idempotency key',
      'recipient and rendered content are admitted only at a trusted server boundary',
      'adapters fail closed on malformed addresses, headers, and oversized content',
    ],
    guarantees: [
      'provider credentials never enter browser contracts',
      'provider receipts retain the application idempotency key',
      'identity-provider courier flows remain independently owned',
    ],
    runtime: {
      operations: {
        deliver: {
          module: '@applik8s/notifications/runtime',
          export: 'deliverApplicationNotification',
          access: {
            kind: 'provider',
            operations: ['connection.use', 'network.connect'],
          },
        },
      },
    },
    accepts(value): value is ApplicationNotificationDeliveryProvider {
      return Boolean(
        value
          && typeof value === 'object'
          && typeof Reflect.get(value, 'provider') === 'string'
          && typeof Reflect.get(value, 'kind') === 'string'
          && (Reflect.get(value, 'mode') === 'inspectable'
            || Reflect.get(value, 'mode') === 'live')
          && typeof Reflect.get(value, 'deliver') === 'function',
      );
    },
  });

export interface CapturedApplicationNotification {
  readonly input: ApplicationNotificationDeliveryInput;
  readonly receipt: ApplicationNotificationDeliveryReceipt;
}

export interface InspectableApplicationNotificationDeliveryProvider
  extends ApplicationNotificationDeliveryProvider {
  readonly mode: 'inspectable';
  inspect(): readonly CapturedApplicationNotification[];
  clear(): void;
}

export interface LocalNotificationDeliveryOptions {
  readonly clock?: () => Date;
  readonly provider?: string;
  readonly rateLimits?: ApplicationNotificationRateLimits;
}

export const LocalNotificationDelivery = Object.freeze({
  inspectable(
    options: LocalNotificationDeliveryOptions = {},
  ): InspectableApplicationNotificationDeliveryProvider {
    const delivered = new Map<string, CapturedApplicationNotification>();
    const clock = options.clock ?? (() => new Date());
    const provider = options.provider ?? 'local';
    const gate = createApplicationNotificationDeliveryGate({
      clock,
      ...(options.rateLimits ? { rateLimits: options.rateLimits } : {}),
    });
    // typecast: literal discriminants preserve the provider's exact public mode and receipt states.
    return Object.freeze({
      provider,
      kind: 'local-inspectable',
      mode: 'inspectable',
      async deliver(input: ApplicationNotificationDeliveryInput) {
        return gate.deliver(input, async (normalized) => {
          const receipt: ApplicationNotificationDeliveryReceipt = Object.freeze({
            provider,
            messageId: `local_${notificationDigest(normalized).slice(0, 32)}`,
            idempotencyKey: normalized.idempotencyKey,
            state: 'queued',
            observedAt: clock().toISOString(),
          });
          delivered.set(
            normalized.idempotencyKey,
            Object.freeze({ input: normalized, receipt }),
          );
          return receipt;
        });
      },
      inspect() {
        return Object.freeze([...delivered.values()]);
      },
      clear() {
        delivered.clear();
      },
    });
  },
});

export interface ApplicationNotificationRequestInput
  extends ApplicationNotificationDeliveryInput {}

const notificationRequests = promotedNotificationModel(
  applicationNotificationRequests,
);

interface ApplicationNotificationRequestBindings {
  readonly NotificationRequest: Pick<
    DrizzleApplicationModelFacet<typeof applicationNotificationRequests>['api'],
    'find' | 'create'
  >;
}

/** @internal Managed-worker hydration for the framework-owned request callable. */
export function createApplicationNotificationRequestCallable(
  bindings: ApplicationNotificationRequestBindings,
) {
  return async function request(input: ApplicationNotificationRequestInput) {
    const normalized = normalizeApplicationNotification(input);
    const existing = await bindings.NotificationRequest.find({
      where: { idempotencyKey: normalized.idempotencyKey },
      limit: 2,
    });
    if (existing.length > 1) {
      throw new Error(
        `Notification idempotency key ${normalized.idempotencyKey} is ambiguous.`,
      );
    }
    if (existing[0]) {
      const stored = deliveryInputFromRequest(existing[0].value);
      if (notificationDigest(stored) !== notificationDigest(normalized)) {
        throw new Error(
          `Notification idempotency key ${normalized.idempotencyKey} was reused with different content.`,
        );
      }
      return existing[0].value;
    }
    return bindings.NotificationRequest.create({
      id: normalized.id,
      idempotencyKey: normalized.idempotencyKey,
      recipientEmail: normalized.recipient.email,
      recipientName: normalized.recipient.name,
      senderEmail: normalized.sender?.email,
      senderName: normalized.sender?.name,
      replyToEmail: normalized.replyTo?.email,
      replyToName: normalized.replyTo?.name,
      subject: normalized.content.subject,
      text: normalized.content.text,
      html: normalized.content.html,
      templateId: normalized.template?.id,
      templateVersion: normalized.template?.version,
      tags: normalized.tags ?? {},
      state: 'pending',
      attempts: 0,
    });
  };
}

function installNotifications(
  application: Pick<KubernetesApplicationBuilder, 'inject'>,
) {
  const delivery = application.inject(
    NotificationDelivery.named('transactional'),
  );
  const requests = notificationRequests;
  async function deliverRequestedNotification(created: {
    readonly value: Record<string, unknown>;
  }) {
    const request = deliveryInputFromRequest(created.value);
    const currentAttempts = numberField(created.value, 'attempts');
    await requests.update({
      identity: request.id,
      patch: {
        state: 'delivering',
        attempts: currentAttempts + 1,
        lastError: null,
      },
    });
    try {
      const receipt = await delivery.deliver(request);
      await requests.update({
        identity: request.id,
        patch: {
          state: receipt.state,
          provider: receipt.provider,
          providerMessageId: receipt.messageId,
          acceptedAt: receipt.observedAt,
          lastError: null,
        },
      });
    } catch (error) {
      await requests.update({
        identity: request.id,
        patch: {
          state: error instanceof ApplicationNotificationDeliveryError
            ? error.outcome
            : 'failed',
          lastError: boundedDeliveryError(error),
        },
      });
      throw error;
    }
  }
  bindApplicationProviderDependencies(deliverRequestedNotification, [
    delivery,
  ]);
  // The table gains its promoted operation methods during module
  // installation. Attach maintained-callable metadata only after promotion so
  // the dependency points at the real, callable update operation.
  bindApplicationCallableDependencies(deliverRequestedNotification, [
    {
      identifier: 'NotificationRequest.update',
      value: requests.update,
      awaited: true,
    },
  ]);

  const request = createApplicationNotificationRequestCallable({
    NotificationRequest: requests,
  });
  bindApplicationCallableDependencies(request, [
    { identifier: 'NotificationRequest.find', value: requests.find },
    { identifier: 'NotificationRequest.create', value: requests.create },
  ], { id: 'notifications.request.v1' });

  const Delivery = requests.on.create(
    {
      processor: { replicas: 1, concurrency: 8 },
      retry: {
        maxAttempts: 8,
        initialDelayMs: 500,
        maxDelayMs: 30_000,
        deadLetter: true,
      },
      budgets: { timeoutMs: 30_000, maxInputBytes: 2_500_000 },
    },
    deliverRequestedNotification,
  );

  return Object.freeze({
    NotificationRequest: requests,
    request,
    Delivery,
    delivery,
  });
}

export const notifications = module(
  'notifications',
  { schema: applicationNotificationSchema },
  installNotifications,
);

function promotedNotificationModel<TTable extends AnyPgTable>(
  table: TTable,
): ApplicationRelationalModel<TTable> {
  // typecast: install() promotes this Drizzle table through app.model before returning the module surface.
  return table as ApplicationRelationalModel<TTable>;
}

function deliveryInputFromRequest(
  value: Record<string, unknown>,
): ApplicationNotificationDeliveryInput {
  const optional = (key: string): string | undefined => {
    const candidate = value[key];
    return typeof candidate === 'string' && candidate.length > 0
      ? candidate
      : undefined;
  };
  const required = (key: string): string => {
    const candidate = optional(key);
    if (!candidate) throw new Error(`Notification request ${key} is missing.`);
    return candidate;
  };
  const recipientName = optional('recipientName');
  const senderEmail = optional('senderEmail');
  const senderName = optional('senderName');
  const replyToEmail = optional('replyToEmail');
  const replyToName = optional('replyToName');
  const html = optional('html');
  const templateId = optional('templateId');
  const templateVersion = optional('templateVersion');
  const tags = value.tags;
  return normalizeApplicationNotification({
    id: required('id'),
    idempotencyKey: required('idempotencyKey'),
    recipient: {
      email: required('recipientEmail'),
      ...(recipientName ? { name: recipientName } : {}),
    },
    ...(senderEmail
      ? { sender: { email: senderEmail, ...(senderName ? { name: senderName } : {}) } }
      : {}),
    ...(replyToEmail
      ? { replyTo: { email: replyToEmail, ...(replyToName ? { name: replyToName } : {}) } }
      : {}),
    content: {
      subject: required('subject'),
      text: required('text'),
      ...(html ? { html } : {}),
    },
    ...(templateId && templateVersion
      ? { template: { id: templateId, version: templateVersion } }
      : {}),
    ...(tags && typeof tags === 'object' && !Array.isArray(tags)
      ? {
        // typecast: normalizeApplicationNotification validates every tag key and value at this untrusted row boundary.
        tags: tags as Readonly<Record<string, string>>,
      }
      : {}),
  });
}

function numberField(value: Record<string, unknown>, key: string): number {
  const candidate = value[key];
  return typeof candidate === 'number' && Number.isSafeInteger(candidate)
    ? candidate
    : 0;
}

function boundedDeliveryError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n\0]+/g, ' ').slice(0, 2_000);
}

export function normalizeApplicationNotification(
  input: ApplicationNotificationDeliveryInput,
): ApplicationNotificationDeliveryInput {
  const id = boundedHeader(input.id, 'notification id', 200);
  const idempotencyKey = boundedHeader(
    input.idempotencyKey,
    'notification idempotency key',
    300,
  );
  const recipient = normalizeAddress(input.recipient, 'recipient');
  const sender = input.sender ? normalizeAddress(input.sender, 'sender') : undefined;
  const replyTo = input.replyTo
    ? normalizeAddress(input.replyTo, 'reply-to')
    : undefined;
  const subject = boundedHeader(input.content.subject, 'notification subject', 998);
  const text = boundedBody(input.content.text, 'notification text', 1_000_000);
  const html = input.content.html === undefined
    ? undefined
    : boundedBody(input.content.html, 'notification HTML', 2_000_000);
  const tags = input.tags
    ? Object.freeze(
        Object.fromEntries(
          Object.entries(input.tags)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, value]) => [
              boundedHeader(key, 'notification tag name', 100),
              boundedHeader(value, `notification tag ${key}`, 500),
            ]),
        ),
      )
    : undefined;
  if (tags && Object.keys(tags).length > 32) {
    throw new Error('Application notifications support at most 32 tags.');
  }
  return Object.freeze({
    id,
    idempotencyKey,
    recipient,
    ...(sender ? { sender } : {}),
    ...(replyTo ? { replyTo } : {}),
    content: Object.freeze({ subject, text, ...(html ? { html } : {}) }),
    ...(input.template
      ? {
          template: Object.freeze({
            id: boundedHeader(input.template.id, 'notification template id', 200),
            version: boundedHeader(
              input.template.version,
              'notification template version',
              100,
            ),
          }),
        }
      : {}),
    ...(tags ? { tags } : {}),
  });
}

/**
 * Adds bounded process-local admission and concurrent idempotency to a
 * delivery adapter. Durable request identity remains owned by the promoted
 * NotificationRequest model; this gate prevents one worker from multiplying a
 * provider effect while a request or retry is in flight.
 */
export function createApplicationNotificationDeliveryGate(options: {
  readonly clock?: () => Date;
  readonly rateLimits?: ApplicationNotificationRateLimits;
} = {}): ApplicationNotificationDeliveryGate {
  const clock = options.clock ?? (() => new Date());
  const limits = options.rateLimits
    ? normalizeApplicationNotificationRateLimits(options.rateLimits)
    : undefined;
  const attempts: number[] = [];
  const recipientAttempts = new Map<string, number[]>();
  const accepted = new Map<string, {
    readonly digest: string;
    readonly receipt: ApplicationNotificationDeliveryReceipt;
  }>();
  const pending = new Map<string, {
    readonly digest: string;
    readonly promise: Promise<ApplicationNotificationDeliveryReceipt>;
  }>();
  const gate: ApplicationNotificationDeliveryGate = {
    async deliver(
      input: ApplicationNotificationDeliveryInput,
      send: (
        normalized: ApplicationNotificationDeliveryInput,
      ) => Promise<ApplicationNotificationDeliveryReceipt>,
    ) {
      const normalized = normalizeApplicationNotification(input);
      const digest = notificationDigest(normalized);
      const previous = accepted.get(normalized.idempotencyKey);
      if (previous) {
        assertSameNotificationDigest(normalized.idempotencyKey, previous.digest, digest);
        return previous.receipt;
      }
      const inFlight = pending.get(normalized.idempotencyKey);
      if (inFlight) {
        assertSameNotificationDigest(normalized.idempotencyKey, inFlight.digest, digest);
        return inFlight.promise;
      }
      if (limits) {
        admitApplicationNotificationRate(
          normalized.recipient.email,
          clock().getTime(),
          limits,
          attempts,
          recipientAttempts,
        );
      }
      const promise = Promise.resolve(send(normalized)).then((receipt) => {
        if (
          receipt.idempotencyKey !== normalized.idempotencyKey
          || !receipt.provider.trim()
          || !receipt.messageId.trim()
          || !Number.isFinite(Date.parse(receipt.observedAt))
        ) {
          throw new Error('Notification provider returned an invalid delivery receipt.');
        }
        accepted.set(normalized.idempotencyKey, { digest, receipt });
        return receipt;
      }).finally(() => {
        pending.delete(normalized.idempotencyKey);
      });
      pending.set(normalized.idempotencyKey, { digest, promise });
      return promise;
    },
  };
  return Object.freeze(gate);
}

function assertSameNotificationDigest(
  idempotencyKey: string,
  previous: string,
  next: string,
): void {
  if (previous !== next) {
    throw new Error(
      `Notification idempotency key ${idempotencyKey} was reused with different content.`,
    );
  }
}

function normalizeApplicationNotificationRateLimits(
  input: ApplicationNotificationRateLimits,
): ApplicationNotificationRateLimits {
  if (!Number.isSafeInteger(input.windowMs) || input.windowMs < 1_000 || input.windowMs > 86_400_000) {
    throw new Error('Notification rate-limit windowMs must be an integer between 1000 and 86400000.');
  }
  if (!Number.isSafeInteger(input.maxDeliveries) || input.maxDeliveries < 1 || input.maxDeliveries > 1_000_000) {
    throw new Error('Notification rate-limit maxDeliveries must be an integer between 1 and 1000000.');
  }
  if (!Number.isSafeInteger(input.maxPerRecipient) || input.maxPerRecipient < 1 || input.maxPerRecipient > input.maxDeliveries) {
    throw new Error('Notification rate-limit maxPerRecipient must be an integer between 1 and maxDeliveries.');
  }
  return Object.freeze({ ...input });
}

function admitApplicationNotificationRate(
  recipient: string,
  now: number,
  limits: ApplicationNotificationRateLimits,
  attempts: number[],
  recipientAttempts: Map<string, number[]>,
): void {
  const cutoff = now - limits.windowMs;
  pruneApplicationNotificationAttempts(attempts, cutoff);
  const forRecipient = recipientAttempts.get(recipient) ?? [];
  pruneApplicationNotificationAttempts(forRecipient, cutoff);
  if (attempts.length >= limits.maxDeliveries) {
    throw new Error('Notification provider rate limit exceeded for this delivery window.');
  }
  if (forRecipient.length >= limits.maxPerRecipient) {
    throw new Error(`Notification recipient ${recipient} exceeded the delivery rate limit.`);
  }
  attempts.push(now);
  forRecipient.push(now);
  recipientAttempts.set(recipient, forRecipient);
}

function pruneApplicationNotificationAttempts(
  attempts: number[],
  cutoff: number,
): void {
  let retained = 0;
  while (retained < attempts.length) {
    const timestamp = attempts[retained];
    if (timestamp === undefined || timestamp > cutoff) break;
    retained += 1;
  }
  if (retained > 0) attempts.splice(0, retained);
}

function normalizeAddress(
  address: ApplicationNotificationAddress,
  label: string,
): ApplicationNotificationAddress {
  const email = boundedHeader(address.email, `${label} email`, 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(`Application notification ${label} email is invalid.`);
  }
  return Object.freeze({
    email,
    ...(address.name
      ? { name: boundedHeader(address.name, `${label} name`, 200) }
      : {}),
  });
}

function boundedHeader(value: string, label: string, maximum: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || /[\r\n\0]/.test(normalized)) {
    throw new Error(`${label} must be non-empty, header-safe, and at most ${maximum} characters.`);
  }
  return normalized;
}

function boundedBody(value: string, label: string, maximumBytes: number): string {
  if (!value.trim() || Buffer.byteLength(value) > maximumBytes || value.includes('\0')) {
    throw new Error(`${label} must be non-empty, NUL-free, and at most ${maximumBytes} bytes.`);
  }
  return value;
}

function notificationDigest(input: ApplicationNotificationDeliveryInput): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}
