import { ApplicationHost, Certificate, DnsPublication, HttpExposure } from '@applik8s/applik8s';
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
  app.provide(HttpExposure, HttpExposure.ingress());
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
} else {
  // OrbStack exposes NodePorts directly on macOS loopback. A local deployment
  // therefore has an endpoint the deployer can authoritatively verify without
  // assuming an ingress controller or editing /etc/hosts.
  app.provide(HttpExposure, HttpExposure.nodePort({ host: '127.0.0.1', nodePort: 30_081 }));
}

app.expose('web', {
  service: host,
  hostnames: [publicHostname ?? 'guestbook.localhost'],
  tls: publicHostname ? { mode: 'managed' } : { mode: 'disabled' },
  dns: publicHostname ? { mode: 'managed' } : { mode: 'disabled' },
});

export { app, GuestBook, GuestBookEntry };
