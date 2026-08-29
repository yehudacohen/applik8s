import { createHash } from 'node:crypto';

function privateProviderIdentity(providerId: string): string {
  return createHash('sha256').update(providerId).digest('hex').slice(0, 16);
}

export function privateProviderConstructorModuleFile(
  providerId: string,
  variant: string,
): string {
  return `provider-${privateProviderIdentity(`${providerId}\0${variant}\0construct`)}.generated.ts`;
}

export function privateProviderValidatorModuleFile(
  providerId: string,
  variant: string,
): string {
  return `provider-${privateProviderIdentity(`${providerId}\0${variant}\0validate`)}.generated.ts`;
}

export function privateProviderRuntimeVariable(providerId: string): string {
  return `provider_${privateProviderIdentity(providerId)}`;
}

export function privateProviderBranchVariable(
  providerId: string,
  variant: string,
  purpose: 'construct' | 'validate',
): string {
  return `provider_${purpose}_${privateProviderIdentity(`${providerId}\0${variant}`)}`;
}

export function privateProviderMountPath(
  providerId: string,
  kind: 'credentials' | 'postgres',
  alias: string,
): string {
  return `${privateProviderMountDirectory(providerId, kind, alias)}/value`;
}

export function privateProviderMountDirectory(
  providerId: string,
  kind: 'credentials' | 'postgres',
  alias: string,
): string {
  return `/var/run/secrets/applik8s/provider-private/${privateProviderIdentity(providerId)}/${kind}/${alias}`;
}

export function privateProviderVolumeName(
  providerId: string,
  kind: 'credential' | 'postgres',
  alias: string,
): string {
  return `provider-${kind}-${privateProviderIdentity(`${providerId}\0${kind}\0${alias}`)}`;
}
