import type {
  ApplicationNotificationDeliveryInput,
  ApplicationNotificationDeliveryProvider,
  ApplicationNotificationDeliveryReceipt,
} from './index.js';
import { LocalNotificationDelivery } from './index.js';

let localDelivery: ReturnType<typeof LocalNotificationDelivery.inspectable>
  | undefined;
let smtpDelivery: ApplicationNotificationDeliveryProvider | undefined;
let smtpDeliveryConfiguration: string | undefined;

/** @internal Managed-worker lowering for the selected notification provider. */
export async function deliverApplicationNotification(
  input: ApplicationNotificationDeliveryInput,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<ApplicationNotificationDeliveryReceipt> {
  const kind = environment.APPLIK8S_NOTIFICATION_DELIVERY_KIND ?? 'local';
  if (kind === 'local') {
    localDelivery ??= LocalNotificationDelivery.inspectable();
    return localDelivery.deliver(input);
  }
  if (kind !== 'smtp') {
    throw new Error(
      `Managed notification delivery kind ${JSON.stringify(kind)} is unsupported.`,
    );
  }
  // static-import-exception: SMTP is an optional provider package and must not load for the dependency-free local profile.
  const { SmtpNotificationDelivery } = await import(
    '@applik8s/notifications-smtp'
  );
  const secure = environment.APPLIK8S_NOTIFICATION_SMTP_SECURE === 'true';
  const host = requiredEnvironment(environment, 'APPLIK8S_NOTIFICATION_SMTP_HOST');
  const port = requiredIntegerEnvironment(
    environment,
    'APPLIK8S_NOTIFICATION_SMTP_PORT',
    1,
    65_535,
  );
  const senderEmail = requiredEnvironment(
    environment,
    'APPLIK8S_NOTIFICATION_SENDER_EMAIL',
  );
  const senderName = environment.APPLIK8S_NOTIFICATION_SENDER_NAME;
  const configuration = JSON.stringify({ host, port, secure, senderEmail, senderName });
  const createProvider = () => SmtpNotificationDelivery.fromSecret({
    host,
    port,
    secure,
    username: { name: 'managed-environment', key: 'username' },
    password: { name: 'managed-environment', key: 'password' },
    sender: {
      email: senderEmail,
      ...(senderName ? { name: senderName } : {}),
    },
    async resolveSecret(reference) {
      return requiredEnvironment(
        environment,
        reference.key === 'username'
          ? 'APPLIK8S_NOTIFICATION_SMTP_USERNAME'
          : 'APPLIK8S_NOTIFICATION_SMTP_PASSWORD',
      );
    },
  });
  let provider: ApplicationNotificationDeliveryProvider;
  if (environment === process.env) {
    if (smtpDeliveryConfiguration !== configuration || !smtpDelivery) {
      smtpDeliveryConfiguration = configuration;
      smtpDelivery = createProvider();
    }
    provider = smtpDelivery;
  } else {
    provider = createProvider();
  }
  return provider.deliver(input);
}

function requiredEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}.`);
  return value;
}

function requiredIntegerEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const value = Number(requiredEnvironment(environment, name));
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}
