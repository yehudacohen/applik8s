import {
  afterEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';
import { loadAgenticRuntimeStripePayments } from '../src/payments-runtime.js';

const environmentNames: readonly [
  'APPLIK8S_INSTALLATION_SPEC',
  'APPLIK8S_PAYMENT_API_KEY',
  'APPLIK8S_PAYMENT_WEBHOOK_SECRET',
] = [
  'APPLIK8S_INSTALLATION_SPEC',
  'APPLIK8S_PAYMENT_API_KEY',
  'APPLIK8S_PAYMENT_WEBHOOK_SECRET',
];
const previousEnvironment = new Map(
  environmentNames.map((name) => [name, process.env[name]]),
);

afterEach(() => {
  vi.unstubAllGlobals();
  for (const name of environmentNames) {
    const previous = previousEnvironment.get(name);
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
});

describe('Agentic Start payment runtime', () => {
  test('reconstructs omitted Stripe endpoint and key defaults from the concrete installation', async () => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (url.includes('/prices?')) {
        return Response.json({ data: [{ id: 'price_team' }] });
      }
      return Response.json({
        id: 'checkout_1',
        url: 'https://checkout.stripe.test/checkout_1',
        customer: 'customer_1',
      });
    });
    process.env.APPLIK8S_INSTALLATION_SPEC = JSON.stringify({
      name: 'documents',
      profile: 'developer',
      providers: {
        payments: { secretName: 'documents-payments' },
      },
    });
    process.env.APPLIK8S_PAYMENT_API_KEY = 'synthetic-api-key';
    process.env.APPLIK8S_PAYMENT_WEBHOOK_SECRET = 'synthetic-webhook-secret';

    const checkout = await loadAgenticRuntimeStripePayments(
      'documents-system',
    ).startCheckout({
      principalScope: 'principal:test',
      plan: 'team',
      returnTo: 'https://documents.example.test/app/billing',
      idempotencyKey: 'checkout:test',
    });

    expect(checkout).toMatchObject({
      provider: 'stripe',
      providerCheckoutId: 'checkout_1',
      mode: 'live',
    });
    expect(requests).toEqual([
      'https://api.stripe.com/v1/prices?lookup_keys%5B%5D=team&active=true&limit=1',
      'https://api.stripe.com/v1/checkout/sessions',
    ]);
  });
});
