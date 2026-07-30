import type {
  ApplicationPrincipal,
  ApplicationRequestAdmission,
  JsonValue,
} from '@applik8s/core';
import {
  createDeterministicApplicationAdmission,
  createDeterministicApplicationPrincipal,
} from '@applik8s/identity';

const admittedAt = '2026-01-01T00:00:00.000Z';

export function testApplicationPrincipal(
  subject: string,
  options: {
    readonly authorityRevision?: string;
    readonly catalogRevision?: string;
    readonly trustedContext?: Readonly<Record<string, JsonValue>>;
  } = {},
): ApplicationPrincipal {
  return {
    ...createDeterministicApplicationPrincipal({
    mode: 'starter',
    application: 'test',
    subject,
    catalogRevision: options.catalogRevision ?? 'catalog-test-v1',
    authorityRevision: options.authorityRevision ?? 'authority-test-v1',
      ...(options.trustedContext ? { trustedContext: options.trustedContext } : {}),
    admittedAt,
    }),
    id: subject,
  };
}

export function testApplicationAdmission(
  subject: string,
  options: {
    readonly authorityRevision?: string;
    readonly catalogRevision?: string;
    readonly trustedContext?: Readonly<Record<string, JsonValue>>;
  } = {},
): ApplicationRequestAdmission {
  const admission = createDeterministicApplicationAdmission({
    mode: 'starter',
    application: 'test',
    subject,
    catalogRevision: options.catalogRevision ?? 'catalog-test-v1',
    authorityRevision: options.authorityRevision ?? 'authority-test-v1',
    ...(options.trustedContext ? { trustedContext: options.trustedContext } : {}),
    admittedAt,
  });
  return { ...admission, principal: { ...admission.principal, id: subject } };
}
