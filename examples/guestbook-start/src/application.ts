import { ApplicationHost, Certificate, DnsPublication } from '@applik8s/tanstack-start';
import { app } from './app';
import { GuestBook, GuestBookEntry } from './models';

export const host = app.provide(
  ApplicationHost,
  ApplicationHost.kubernetes({
    namespace: process.env.APPLIK8S_NAMESPACE ?? 'guestbook',
    replicas: Number(process.env.APPLIK8S_WEB_REPLICAS ?? '1'),
    resources: {
      requests: { cpu: '100m', memory: '128Mi' },
      limits: { memory: '256Mi' },
    },
  }),
);

const publicHostname = process.env.APPLIK8S_PUBLIC_HOSTNAME;
if (publicHostname) {
  app.provide(
    Certificate,
    Certificate.certManager({
      issuerRef: {
        name: process.env.APPLIK8S_CERTIFICATE_ISSUER ?? 'letsencrypt-prod',
        kind: 'ClusterIssuer',
      },
    }),
  );
  app.provide(DnsPublication, DnsPublication.externalDns());
}

app.expose('web', {
  service: host,
  hostnames: [publicHostname ?? 'guestbook.localhost'],
  tls: publicHostname ? { mode: 'managed' } : { mode: 'disabled' },
  dns: publicHostname ? { mode: 'managed' } : { mode: 'disabled' },
});

export { app, GuestBook, GuestBookEntry };
