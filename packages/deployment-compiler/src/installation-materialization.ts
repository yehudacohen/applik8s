// typecast-file-boundary: Installation CEL evaluation is a validated JSON
// materialization boundary between symbolic plans and concrete target values.
import type {
  DeploymentJsonObject,
  DeploymentJsonValue,
} from '@applik8s/deployment-contract';

/**
 * Resolve concrete installation-schema references at an instance planning
 * boundary. The authored TypeKro graph remains symbolic; only validation and
 * provider planning for the selected instance consume this projection.
 */
export function materializeInstallationValue(
  value: DeploymentJsonValue,
  installationSpec: DeploymentJsonObject,
): DeploymentJsonValue | undefined {
  if (typeof value === 'string') {
    const exact = /^\$\{schema\.spec((?:\.[A-Za-z_][A-Za-z0-9_]*)*)\}$/.exec(value);
    if (exact) return installationPathValue(installationSpec, exact[1] ?? '');
    const conditional = materializeInstallationConditional(value, installationSpec);
    if (conditional.matched) return conditional.value;
    const interpolated = value.replace(
      /\$\{schema\.spec((?:\.[A-Za-z_][A-Za-z0-9_]*)*)\}/g,
      (_marker, path: string) => {
        const resolved = installationPathValue(installationSpec, path);
        if (resolved === undefined || resolved === null || typeof resolved === 'object') {
          throw new Error(
            `Application deployment value cannot interpolate installation path schema.spec${path} as text.`,
          );
        }
        return String(resolved);
      },
    );
    return interpolated;
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => materializeInstallationValue(entry, installationSpec))
      .filter((entry): entry is DeploymentJsonValue => entry !== undefined);
  }
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => {
      const materialized = materializeInstallationValue(entry, installationSpec);
      return materialized === undefined ? [] : [[key, materialized]];
    }),
  ) as DeploymentJsonObject;
}

function materializeInstallationConditional(
  value: string,
  installationSpec: DeploymentJsonObject,
): { readonly matched: false } | { readonly matched: true; readonly value: DeploymentJsonValue } {
  const marker = /^\$\{\(schema\.spec((?:\.[A-Za-z_][A-Za-z0-9_]*)*)\)\s*==\s*("(?:[^"\\]|\\.)*")\s*\?\s*\((true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?|"(?:[^"\\]|\\.)*")\)\s*:\s*\((true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?|"(?:[^"\\]|\\.)*")\)\}$/u.exec(value);
  if (!marker) return { matched: false };
  const actual = installationPathValue(installationSpec, marker[1] ?? '');
  const expected = JSON.parse(marker[2] ?? 'null') as DeploymentJsonValue;
  const whenTrue = JSON.parse(marker[3] ?? 'null') as DeploymentJsonValue;
  const whenFalse = JSON.parse(marker[4] ?? 'null') as DeploymentJsonValue;
  return { matched: true, value: actual === expected ? whenTrue : whenFalse };
}

function installationPathValue(
  installationSpec: DeploymentJsonObject,
  path: string,
): DeploymentJsonValue | undefined {
  let current: DeploymentJsonValue | undefined = installationSpec;
  for (const segment of path.split('.').filter(Boolean)) {
    if (!deploymentJsonObject(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function deploymentJsonObject(value: DeploymentJsonValue | undefined): value is DeploymentJsonObject {
  return value !== undefined
    && value !== null
    && typeof value === 'object'
    && !Array.isArray(value);
}
