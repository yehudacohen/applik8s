import type { ApplicationPaymentProvider } from '@applik8s/billing';
import {
  type PaymentSecretReference,
  StripePayments,
} from '@applik8s/billing-stripe';

/**
 * Reconstructs a Stripe provider from the concrete installation delivered to
 * a managed operation host. Application discovery sees schema references;
 * credentials and provider configuration become concrete only here.
 */
export function loadAgenticRuntimeStripePayments(
  namespace: string,
): ApplicationPaymentProvider {
  const installation = requiredInstallationSpec();
  const payments = installation.providers?.payments;
  if (!payments || typeof payments !== 'object' || Array.isArray(payments)) {
    throw new Error(
      'The active Agentic installation does not configure a live payment provider.',
    );
  }
  const secretName = requiredConfigurationString(
    payments,
    'secretName',
    'Agentic Stripe payments require providers.payments.secretName.',
  );
  return StripePayments.fromSecret({
    endpoint: optionalConfigurationString(payments, 'endpoint')
      ?? 'https://api.stripe.com/v1',
    secrets: {
      apiKey: {
        name: secretName,
        namespace,
        key: optionalConfigurationString(payments, 'apiKeyKey') ?? 'apiKey',
      },
      webhookSecret: {
        name: secretName,
        namespace,
        key: optionalConfigurationString(payments, 'webhookSecretKey')
          ?? 'webhookSecret',
      },
    },
    resolveSecret: resolveAgenticPaymentSecret,
  });
}

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

function requiredInstallationSpec(): {
  readonly providers?: Readonly<Record<string, unknown>>;
} {
  const encoded = process.env.APPLIK8S_INSTALLATION_SPEC;
  if (!encoded) {
    throw new Error(
      'Agentic payment execution requires APPLIK8S_INSTALLATION_SPEC.',
    );
  }
  const decoded: unknown = JSON.parse(encoded);
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
    throw new Error('APPLIK8S_INSTALLATION_SPEC must contain an object.');
  }
  const providers = Reflect.get(decoded, 'providers');
  if (providers !== undefined && !isUnknownRecord(providers)) {
    throw new Error('Agentic installation providers must contain an object.');
  }
  return providers === undefined
    ? {}
    : { providers };
}

function isUnknownRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function optionalConfigurationString(
  source: object,
  key: string,
): string | undefined {
  const value = Reflect.get(source, key);
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Agentic Stripe payments require a non-empty ${key}.`);
  }
  return value;
}

function requiredConfigurationString(
  source: object,
  key: string,
  message: string,
): string {
  const value = optionalConfigurationString(source, key);
  if (!value) throw new Error(message);
  return value;
}
