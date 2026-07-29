import { ApplicationHost, Certificate, DnsPublication, HttpExposure } from '@applik8s/applik8s';
import { externalRef } from 'typekro';
import { app, capacity, namespace, publicExposure } from './app';
import { Account, Attachments, Automation, AutomationControl, AutomationRun, Avatars, Block, Bookmark, DefaultModerationPolicy, Follow, gateway, Media, ModerationCase, ModerationPolicy, Mute, Notification, Post, ProjectionArtifacts, Reaction, RebuildHomeTimelines, Report } from './models';

/**
 * The portable deployment graph hoists this Namespace through a TypeKro
 * direct declaration before generated credentials and the KRO application.
 * The root composition observes that lifecycle boundary without duplicating it.
 */
export const workloadNamespace = app.infra(() => externalRef({
  apiVersion: 'v1',
  kind: 'Namespace',
  id: 'chirpWorkloadNamespace',
  metadata: { name: namespace },
}));

export const host = app.provide(ApplicationHost, ApplicationHost.kubernetes({
  namespace,
  // The checked-in starter profile must fit on a single-node development
  // cluster. Dedicated installations opt into horizontal redundancy through
  // the deployment environment without changing the application model.
  replicas: capacity.webReplicas,
  resources: {
    requests: { cpu: capacity.webCpuRequest, memory: capacity.webMemoryRequest },
    limits: { cpu: capacity.webCpuLimit, memory: capacity.webMemoryLimit },
  },
}));

app.provide(Certificate, Certificate.certManager({
  issuerRef: { name: app.installation.spec.exposure.certificateIssuerName, kind: 'ClusterIssuer' },
}));
app.provide(DnsPublication, DnsPublication.externalDns());

app.installation.configure((spec, installation) => {
  installation.expose('web-public', {
    enabled: publicExposure,
    provider: HttpExposure.ingress(),
    service: host,
    hostnames: [spec.hostname],
    tls: { mode: 'managed' },
    dns: { mode: 'managed' },
  });
  installation.expose('web-local', {
    enabled: app.select(spec.exposure.mode, { ingress: false, default: true }),
    provider: HttpExposure.nodePort({ host: '127.0.0.1', nodePort: spec.exposure.nodePort }),
    service: host,
    hostnames: [spec.hostname],
    tls: { mode: 'disabled' },
    dns: { mode: 'disabled' },
  });
});

export { ChirpInstallation } from './app';
export type { TimelinePostValue } from './models';
export { Account, Attachments, Automation, AutomationControl, AutomationRun, Avatars, app, Block, Bookmark, DefaultModerationPolicy, Follow, gateway, Media, ModerationCase, ModerationPolicy, Mute, Notification, Post, ProjectionArtifacts, Reaction, RebuildHomeTimelines, Report };
