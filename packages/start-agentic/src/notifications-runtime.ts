import type { SmtpNotificationSecretReference } from '@applik8s/notifications-smtp';

/** Server-only SMTP credential resolution for generated notification workers. */
export async function resolveAgenticNotificationSecret(
  reference: SmtpNotificationSecretReference,
): Promise<string> {
  const key = reference.key ?? 'username';
  const environmentName = key === 'password'
    ? 'APPLIK8S_NOTIFICATION_SMTP_PASSWORD'
    : 'APPLIK8S_NOTIFICATION_SMTP_USERNAME';
  const value = process.env[environmentName];
  if (!value) {
    throw new Error(
      `Notification Secret ${reference.namespace ?? 'default'}/${reference.name} key ${key} is not hydrated as ${environmentName}.`,
    );
  }
  return value;
}
