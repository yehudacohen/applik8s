import { app as defineApplication, IdentityProvider } from '@applik8s/applik8s';

export const app = defineApplication(
  process.env.APPLIK8S_APPLICATION_NAME ?? 'guestbook-start',
  { namespace: process.env.APPLIK8S_NAMESPACE ?? 'guestbook' },
);

if (process.env.APPLIK8S_PUBLIC_HOSTNAME && process.env.APPLIK8S_ALLOW_INSECURE_DEMO_IDENTITY !== '1') {
  throw new Error(
    'The GuestBook demo identity grants author access to every request. Public exposure requires a real IdentityProvider provider; '
    + 'set APPLIK8S_ALLOW_INSECURE_DEMO_IDENTITY=1 only for an explicitly disposable demonstration.',
  );
}

app.provide(
  IdentityProvider,
  IdentityProvider.from(async () => ({
    principal: { id: 'guestbook-demo' },
    authorizationVersion: 'demo-v1',
    trustedContext: {
      guestbook: 'main',
      namespace: process.env.APPLIK8S_NAMESPACE ?? 'guestbook',
      role: 'author',
    },
  })),
);
