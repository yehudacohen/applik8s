import type { PaymentSecretReference } from '@applik8s/billing-stripe';

/**
 * Server-only resolution seam for payment adapters.
 *
 * The generated host maps the two canonical environment names from the
 * installation's Kubernetes Secret. Keeping resolution behind this module
 * prevents secret material from entering provider graphs or browser bundles.
 */
export async function resolveAgenticPaymentSecret(
  reference: PaymentSecretReference,
): Promise<string> {
  const key = reference.key ?? 'apiKey';
  const environmentName = key === 'webhookSecret'
    ? 'APPLIK8S_PAYMENT_WEBHOOK_SECRET'
    : 'APPLIK8S_PAYMENT_API_KEY';
  const value = process.env[environmentName];
  if (!value) {
    throw new Error(
      `Payment Secret ${reference.namespace ?? 'default'}/${reference.name} key ${key} is not hydrated as ${environmentName}.`,
    );
  }
  return value;
}
