import type {
  ApplicationNotificationAddress,
  ApplicationNotificationDeliveryInput,
  ApplicationNotificationDeliveryProvider,
  ApplicationNotificationDeliveryReceipt,
  ApplicationNotificationRateLimits,
} from '@applik8s/notifications';
import {
  ApplicationNotificationDeliveryError,
  createApplicationNotificationDeliveryGate,
  normalizeApplicationNotification,
} from '@applik8s/notifications';
import nodemailer from 'nodemailer';

export interface SmtpNotificationSecretReference {
  readonly name: string;
  readonly key?: string;
  readonly namespace?: string;
}

export interface SmtpNotificationDeliveryOptions {
  readonly host: string;
  readonly port: number;
  /** True for implicit TLS. STARTTLS remains required when false. */
  readonly secure?: boolean;
  readonly username: SmtpNotificationSecretReference;
  readonly password: SmtpNotificationSecretReference;
  readonly sender: ApplicationNotificationAddress;
  resolveSecret(reference: SmtpNotificationSecretReference): Promise<string>;
  readonly connectionTimeoutMs?: number;
  readonly greetingTimeoutMs?: number;
  readonly socketTimeoutMs?: number;
  readonly tls?: {
    readonly servername?: string;
    /** Production defaults to true and must be disabled explicitly. */
    readonly rejectUnauthorized?: boolean;
  };
  readonly clock?: () => Date;
  /** Bounded process-local abuse control; durable request identity is application-owned. */
  readonly rateLimits?: ApplicationNotificationRateLimits;
}

export const SmtpNotificationDelivery = Object.freeze({
  fromSecret(
    options: SmtpNotificationDeliveryOptions,
  ): ApplicationNotificationDeliveryProvider {
    // Profile branches may carry TypeKro schema proxies while the application
    // graph is being authored. Concrete installation values are already
    // constrained by the installation schema; repeat the fail-closed checks
    // whenever this adapter is constructed from ordinary runtime values.
    const host = typeof options.host === 'string'
      ? requiredSingleLine(options.host, 'SMTP host')
      : options.host;
    if (
      typeof options.port === 'number'
      && (!Number.isSafeInteger(options.port)
        || options.port < 1
        || options.port > 65_535)
    ) {
      throw new Error('SMTP port must be an integer between 1 and 65535.');
    }
    const sender = typeof options.sender.email === 'string'
      ? normalizeApplicationNotification({
          id: 'smtp-sender-validation',
          idempotencyKey: 'smtp-sender-validation',
          recipient: options.sender,
          content: { subject: 'validation', text: 'validation' },
        }).recipient
      : options.sender;
    const clock = options.clock ?? (() => new Date());
    const connectionTimeout = boundedTimeout(
      options.connectionTimeoutMs ?? 10_000,
      'SMTP connection timeout',
    );
    const greetingTimeout = boundedTimeout(
      options.greetingTimeoutMs ?? 10_000,
      'SMTP greeting timeout',
    );
    const socketTimeout = boundedTimeout(
      options.socketTimeoutMs ?? 30_000,
      'SMTP socket timeout',
    );
    const gate = createApplicationNotificationDeliveryGate({
      clock,
      rateLimits: options.rateLimits ?? {
        windowMs: 60_000,
        maxDeliveries: 100,
        maxPerRecipient: 10,
      },
    });
    // typecast: the literal mode discriminant keeps this adapter narrowed to the live provider contract.
    return Object.freeze({
      provider: 'smtp',
      kind: 'smtp',
      mode: 'live',
      async deliver(
        input: ApplicationNotificationDeliveryInput,
      ): Promise<ApplicationNotificationDeliveryReceipt> {
        if (input.sender && !sameAddress(input.sender, sender)) {
          throw new Error('SMTP notification sender must match the configured sender policy.');
        }
        return gate.deliver({ ...input, sender }, async (normalized) => {
          const [user, pass] = await Promise.all([
            options.resolveSecret(options.username),
            options.resolveSecret(options.password),
          ]);
          if (!user || !pass) {
            throw new Error('SMTP credentials resolved to an empty value.');
          }
          const transport = nodemailer.createTransport({
            host,
            port: options.port,
            secure: options.secure ?? false,
            requireTLS: !(options.secure ?? false),
            auth: { user, pass },
            connectionTimeout,
            greetingTimeout,
            socketTimeout,
            tls: {
              servername: options.tls?.servername ?? host,
              rejectUnauthorized: options.tls?.rejectUnauthorized ?? true,
            },
          });
          try {
            let result: Awaited<ReturnType<typeof transport.sendMail>>;
            try {
              result = await transport.sendMail({
                envelope: {
                  from: normalized.sender?.email ?? sender.email,
                  to: [normalized.recipient.email],
                },
                from: formattedAddress(normalized.sender ?? sender),
                to: formattedAddress(normalized.recipient),
                ...(normalized.replyTo
                  ? { replyTo: formattedAddress(normalized.replyTo) }
                  : {}),
                subject: normalized.content.subject,
                text: normalized.content.text,
                ...(normalized.content.html
                  ? { html: normalized.content.html }
                  : {}),
                headers: {
                  'X-Applik8s-Notification-Id': normalized.id,
                  'X-Applik8s-Idempotency-Key': normalized.idempotencyKey,
                },
              });
            } catch (cause) {
              throw new ApplicationNotificationDeliveryError(
                'unknown',
                'SMTP delivery failed without authoritative proof that the provider rejected the message.',
                { cause },
              );
            }
            const messageId = requiredSingleLine(
              result.messageId,
              'SMTP provider message id',
            );
            return {
              provider: 'smtp',
              messageId,
              idempotencyKey: normalized.idempotencyKey,
              state: 'queued',
              observedAt: clock().toISOString(),
            };
          } finally {
            transport.close();
          }
        });
      },
    });
  },
});

function sameAddress(
  candidate: ApplicationNotificationAddress,
  configured: ApplicationNotificationAddress,
): boolean {
  const normalized = normalizeApplicationNotification({
    id: 'smtp-sender-comparison',
    idempotencyKey: 'smtp-sender-comparison',
    recipient: candidate,
    content: { subject: 'validation', text: 'validation' },
  }).recipient;
  return normalized.email === configured.email
    && (normalized.name ?? '') === (configured.name ?? '');
}

function formattedAddress(address: ApplicationNotificationAddress): string {
  return address.name
    ? `${JSON.stringify(address.name)} <${address.email}>`
    : address.email;
}

function boundedTimeout(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 100 || value > 120_000) {
    throw new Error(`${label} must be an integer between 100 and 120000 milliseconds.`);
  }
  return value;
}

function requiredSingleLine(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || /[\r\n\0]/.test(normalized)) {
    throw new Error(`${label} must be non-empty and single-line.`);
  }
  return normalized;
}
