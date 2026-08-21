import { app, defineApplicationProvider, type } from '../../src/index.js';

const application = app('provider-callback-dependencies', {
  namespace: 'provider-callback-dependencies',
  spec: type({ profile: "'starter' | 'dedicated'" }),
  status: type({ ready: 'boolean' }),
});

const deployment = application.profile(application.installation.spec, 'profile');

const PrimaryProvider = defineApplicationProvider<{
  readonly kind: 'primary';
  acquire(input: { readonly id: string }): Promise<{ readonly value: string }>;
}>({
  interface: 'PrimaryProvider',
  version: 'v1alpha1',
  accepts: (candidate): candidate is {
    readonly kind: 'primary';
    acquire(input: { readonly id: string }): Promise<{ readonly value: string }>;
  } => candidate !== null && typeof candidate === 'object'
    && Reflect.get(candidate, 'kind') === 'primary',
}).named('active');

const SecondaryProvider = defineApplicationProvider<{
  readonly kind: 'secondary';
  acquire(input: { readonly id: string }): Promise<{ readonly value: string }>;
}>({
  interface: 'SecondaryProvider',
  version: 'v1alpha1',
  accepts: (candidate): candidate is {
    readonly kind: 'secondary';
    acquire(input: { readonly id: string }): Promise<{ readonly value: string }>;
  } => candidate !== null && typeof candidate === 'object'
    && Reflect.get(candidate, 'kind') === 'secondary',
}).named('unused');

const primaryImplementation = (source: string) => ({
  kind: 'primary' as const,
  async acquire({ id }: { readonly id: string }) {
    return { value: `${source}:${id}` };
  },
});

deployment
  .provide(PrimaryProvider)
  .starter(() => primaryImplementation('starter'))
  .dedicated(() => primaryImplementation('dedicated'))
  .exhaustive();

deployment
  .provide(SecondaryProvider)
  .starter(() => ({
    kind: 'secondary' as const,
    async acquire({ id }: { readonly id: string }) {
      return { value: `secondary-starter:${id}` };
    },
  }))
  .dedicated(() => ({
    kind: 'secondary' as const,
    async acquire({ id }: { readonly id: string }) {
      return { value: `secondary-dedicated:${id}` };
    },
  }))
  .exhaustive();

const primary = application.inject(PrimaryProvider);
export const acquire = primary.acquire;

