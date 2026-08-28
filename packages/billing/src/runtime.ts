// typecast-file-boundary: Billing provider results and persisted records are schema-validated before conversion to the provider-neutral runtime contract.
import type {
  ApplicationPaymentProvider,
  BillingUsageReport,
  BillingUsageReportInput,
  PaymentCheckout,
  PaymentCheckoutInput,
  PaymentPortal,
  PaymentPortalInput,
  PaymentProviderEvent,
  PaymentWebhookInput,
  SubscriptionCancellationInput,
  SubscriptionCancellationResult,
  SubscriptionChangeInput,
  SubscriptionChangePreview,
  SubscriptionChangeResult,
} from './index.js';
import { LocalPayments } from './index.js';

let processProvider: ApplicationPaymentProvider | undefined;
let processConfiguration: string | undefined;

/** @internal Managed-worker lowering for the selected provider identity. */
export async function identifyPaymentProvider(
  _input: undefined,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<string> {
  return (await paymentProvider(environment)).provider;
}

/** @internal Managed-worker lowering for PaymentProvider.startCheckout. */
export async function startPaymentCheckout(
  input: PaymentCheckoutInput,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<PaymentCheckout> {
  return (await paymentProvider(environment)).startCheckout(input);
}

/** @internal Managed-worker lowering for PaymentProvider.openPortal. */
export async function openPaymentPortal(
  input: PaymentPortalInput,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<PaymentPortal> {
  return (await paymentProvider(environment)).openPortal(input);
}

/** @internal Managed-worker lowering for PaymentProvider.previewSubscriptionChange. */
export async function previewPaymentSubscriptionChange(
  input: SubscriptionChangeInput,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<SubscriptionChangePreview> {
  return requirePaymentMethod(
    await paymentProvider(environment),
    'previewSubscriptionChange',
  )(input);
}

/** @internal Managed-worker lowering for PaymentProvider.changeSubscription. */
export async function changePaymentSubscription(
  input: SubscriptionChangeInput,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<SubscriptionChangeResult> {
  return requirePaymentMethod(
    await paymentProvider(environment),
    'changeSubscription',
  )(input);
}

/** @internal Managed-worker lowering for PaymentProvider.cancelSubscription. */
export async function cancelPaymentSubscription(
  input: SubscriptionCancellationInput,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<SubscriptionCancellationResult> {
  return requirePaymentMethod(
    await paymentProvider(environment),
    'cancelSubscription',
  )(input);
}

/** @internal Managed-worker lowering for PaymentProvider.resumeSubscription. */
export async function resumePaymentSubscription(
  input: Omit<SubscriptionCancellationInput, 'timing'>,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<SubscriptionCancellationResult> {
  return requirePaymentMethod(
    await paymentProvider(environment),
    'resumeSubscription',
  )(input);
}

/** @internal Managed-worker lowering for PaymentProvider.reportUsage. */
export async function reportPaymentUsage(
  input: BillingUsageReportInput,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<BillingUsageReport> {
  return requirePaymentMethod(
    await paymentProvider(environment),
    'reportUsage',
  )(input);
}

/** @internal Managed-worker lowering for PaymentProvider.verifyWebhook. */
export async function verifyPaymentWebhook(
  input: PaymentWebhookInput,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<PaymentProviderEvent> {
  return requirePaymentMethod(
    await paymentProvider(environment),
    'verifyWebhook',
  )(input);
}

async function paymentProvider(
  environment: Readonly<Record<string, string | undefined>>,
): Promise<ApplicationPaymentProvider> {
  const kind = environment.APPLIK8S_PAYMENT_PROVIDER_KIND ?? 'local';
  const origin = environment.APPLIK8S_PAYMENT_ORIGIN
    ?? 'http://127.0.0.1:3000';
  const endpoint = environment.APPLIK8S_PAYMENT_ENDPOINT
    ?? 'https://api.stripe.com/v1';
  const tolerance = optionalPositiveInteger(
    environment.APPLIK8S_PAYMENT_WEBHOOK_TOLERANCE_SECONDS,
    'APPLIK8S_PAYMENT_WEBHOOK_TOLERANCE_SECONDS',
  ) ?? 300;
  const configuration = JSON.stringify({ kind, origin, endpoint, tolerance });
  const create = async (): Promise<ApplicationPaymentProvider> => {
    if (kind === 'local') return LocalPayments.simulated({ origin });
    if (kind !== 'stripe') {
      throw new Error(
        `Managed payment provider kind ${JSON.stringify(kind)} is unsupported.`,
      );
    }
    // Stripe is an optional provider package and must not load in applications
    // static-import-exception: that select the dependency-free local adapter.
    const { StripePayments } = await import('@applik8s/billing-stripe');
    return StripePayments.fromSecret({
      endpoint,
      webhookToleranceSeconds: tolerance,
      secrets: {
        apiKey: { name: 'managed-environment', key: 'apiKey' },
        webhookSecret: {
          name: 'managed-environment',
          key: 'webhookSecret',
        },
      },
      async resolveSecret(reference) {
        return requiredEnvironment(
          environment,
          reference.key === 'webhookSecret'
            ? 'APPLIK8S_PAYMENT_WEBHOOK_SECRET'
            : 'APPLIK8S_PAYMENT_API_KEY',
        );
      },
    });
  };
  if (environment !== process.env) return create();
  if (!processProvider || processConfiguration !== configuration) {
    processProvider = await create();
    processConfiguration = configuration;
  }
  return processProvider;
}

type OptionalPaymentMethod =
  | 'previewSubscriptionChange'
  | 'changeSubscription'
  | 'cancelSubscription'
  | 'resumeSubscription'
  | 'reportUsage'
  | 'verifyWebhook';

function requirePaymentMethod<TMethod extends OptionalPaymentMethod>(
  provider: ApplicationPaymentProvider,
  method: TMethod,
): NonNullable<ApplicationPaymentProvider[TMethod]> {
  const callable = provider[method];
  if (typeof callable !== 'function') {
    throw new Error(
      `Managed payment provider ${provider.kind} does not support ${method}.`,
    );
  }
  return callable.bind(provider) as NonNullable<
    ApplicationPaymentProvider[TMethod]
  >;
}

function requiredEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}.`);
  return value;
}

function optionalPositiveInteger(
  value: string | undefined,
  name: string,
): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return number;
}
// typecast-file-boundary: Billing provider results and persisted records are schema-validated before conversion to the provider-neutral runtime contract.
