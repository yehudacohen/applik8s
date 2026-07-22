// typecast-file-boundary: Installation runtime decoding validates the wire contract before exposing its generic typed model boundary.
import { normalizeSchema, type SchemaInput } from '@applik8s/sdk';

export const applicationInstallationSpecEnvironmentVariable = 'APPLIK8S_INSTALLATION_SPEC';

export interface ApplicationInstallationRuntimeEnvironment {
  readonly APPLIK8S_INSTALLATION_SPEC?: string;
}

/**
 * Read the concrete, KRO-owned Application desired state injected into an
 * authored server, gateway, processor, projection, or workflow workload.
 *
 * The value contains the public installation spec and Secret coordinates,
 * never resolved Secret data. Validation happens at every runtime boundary so
 * a stale or malformed ConfigMap cannot silently select provider behavior.
 */
export function readApplicationInstallationSpec<TSpec extends object>(
  schema: SchemaInput<TSpec>,
  environment: ApplicationInstallationRuntimeEnvironment = runtimeEnvironment(),
): TSpec {
  const encoded = environment.APPLIK8S_INSTALLATION_SPEC;
  if (!encoded?.trim()) {
    throw new Error(`${applicationInstallationSpecEnvironmentVariable} is required in an installable Application runtime.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded);
  } catch (cause) {
    throw new Error(`${applicationInstallationSpecEnvironmentVariable} must contain valid JSON.`, { cause });
  }
  const validated = normalizeSchema(schema, 'Application installation runtime spec').validate(parsed as never);
  if (!validated.ok) {
    throw new Error(`${applicationInstallationSpecEnvironmentVariable} does not satisfy the declared Application installation schema: ${validated.error.message}`);
  }
  return validated.value;
}

function runtimeEnvironment(): ApplicationInstallationRuntimeEnvironment {
  if (typeof process === 'undefined' || !process.env) return {};
  const encoded = process.env.APPLIK8S_INSTALLATION_SPEC;
  return encoded === undefined ? {} : { APPLIK8S_INSTALLATION_SPEC: encoded };
}
