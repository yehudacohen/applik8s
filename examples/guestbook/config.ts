export type GuestBookDeploymentProfile = 'local' | 'public';

export interface GuestBookConfig {
  readonly profile: GuestBookDeploymentProfile;
  readonly apiGroup: string;
  readonly namespace: string;
  readonly operatorName: string;
  readonly stackName: string;
  readonly stackKind: string;
  readonly bookName: string;
  readonly title: string;
  readonly description: string;
  readonly serverImage: string;
  readonly hostname: string;
  readonly ingressClassName?: string;
  readonly issuerRef?: { readonly name: string; readonly kind: 'Issuer' | 'ClusterIssuer' };
  readonly certificateSecretName?: string;
  readonly dnsTtlSeconds: number;
}

export function guestBookConfigFromEnvironment(env: Readonly<Record<string, string | undefined>> = process.env): GuestBookConfig {
  const profile = env.APPLIK8S_GUESTBOOK_PROFILE ?? 'local';
  if (profile !== 'local' && profile !== 'public') {
    throw new Error('APPLIK8S_GUESTBOOK_PROFILE must be "local" or "public".');
  }
  const hostname = env.APPLIK8S_GUESTBOOK_DOMAIN ?? (profile === 'local' ? 'guestbook.localhost' : undefined);
  if (!hostname) throw new Error('The public GuestBook profile requires APPLIK8S_GUESTBOOK_DOMAIN.');
  const issuerName = env.APPLIK8S_GUESTBOOK_ISSUER_NAME;
  const issuerKind = env.APPLIK8S_GUESTBOOK_ISSUER_KIND ?? 'ClusterIssuer';
  if (profile === 'public' && !issuerName) throw new Error('The public GuestBook profile requires APPLIK8S_GUESTBOOK_ISSUER_NAME.');
  if (issuerKind !== 'Issuer' && issuerKind !== 'ClusterIssuer') {
    throw new Error('APPLIK8S_GUESTBOOK_ISSUER_KIND must be "Issuer" or "ClusterIssuer".');
  }
  const dnsTtlSeconds = Number(env.APPLIK8S_GUESTBOOK_DNS_TTL_SECONDS ?? '120');
  if (!Number.isInteger(dnsTtlSeconds) || dnsTtlSeconds < 1 || dnsTtlSeconds > 86_400) {
    throw new Error('APPLIK8S_GUESTBOOK_DNS_TTL_SECONDS must be an integer from 1 through 86400.');
  }
  return {
    profile,
    apiGroup: env.APPLIK8S_GUESTBOOK_API_GROUP ?? 'guestbook.applik8s.dev',
    namespace: env.APPLIK8S_GUESTBOOK_NAMESPACE ?? 'guestbook',
    operatorName: env.APPLIK8S_GUESTBOOK_OPERATOR_NAME ?? 'guestbook-renderer',
    stackName: env.APPLIK8S_GUESTBOOK_STACK_NAME ?? 'guestbook-stack',
    stackKind: env.APPLIK8S_GUESTBOOK_STACK_KIND ?? 'GuestBookStack',
    bookName: env.APPLIK8S_GUESTBOOK_BOOK_NAME ?? 'main',
    title: env.APPLIK8S_GUESTBOOK_TITLE ?? 'applik8s GuestBook',
    description: env.APPLIK8S_GUESTBOOK_DESCRIPTION ?? 'Entries are moderated CRDs served through a cached typed index.',
    serverImage: env.APPLIK8S_GUESTBOOK_SERVER_IMAGE ?? 'node:22-alpine',
    hostname,
    ...(env.APPLIK8S_GUESTBOOK_INGRESS_CLASS ? { ingressClassName: env.APPLIK8S_GUESTBOOK_INGRESS_CLASS } : {}),
    ...(issuerName ? { issuerRef: { name: issuerName, kind: issuerKind } } : {}),
    ...(env.APPLIK8S_GUESTBOOK_TLS_SECRET_NAME ? { certificateSecretName: env.APPLIK8S_GUESTBOOK_TLS_SECRET_NAME } : {}),
    dnsTtlSeconds,
  };
}

export const guestBookConfig = guestBookConfigFromEnvironment();
