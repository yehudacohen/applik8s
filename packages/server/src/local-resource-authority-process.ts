// typecast-file-boundary: Local operator artifacts cross an environment JSON boundary and are field-validated before runtime activation.
import { startApplik8sLocalResourceAuthority } from './local-resource-authority.js';
import { startApplik8sLocalOperatorRuntime, type Applik8sLocalOperatorArtifact } from './local-operator-runtime.js';

const authority = await startApplik8sLocalResourceAuthority({
  statePath: requiredEnv('APPLIK8S_LOCAL_RESOURCE_STATE_PATH'),
  token: requiredEnv('APPLIK8S_LOCAL_RESOURCE_TOKEN'),
  port: Number(requiredEnv('PORT')),
});

process.stdout.write(`Applik8s local resource authority listening on ${authority.origin}\n`);
const operators = await startApplik8sLocalOperatorRuntime(operatorArtifacts(), authority.store);

const stop = async (): Promise<void> => {
  operators.close();
  await authority.close();
  process.exitCode = 0;
};
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required by the local resource authority.`);
  return value;
}

function operatorArtifacts(): readonly Applik8sLocalOperatorArtifact[] {
  const encoded = process.env.APPLIK8S_LOCAL_OPERATOR_ARTIFACTS;
  if (!encoded) return [];
  const value = JSON.parse(encoded) as unknown;
  if (!Array.isArray(value)) throw new Error('APPLIK8S_LOCAL_OPERATOR_ARTIFACTS must be a JSON array.');
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`Local operator artifact ${index} must be an object.`);
    const artifact = entry as Record<string, unknown>;
    for (const field of ['name', 'manifest', 'source', 'digest'] as const) if (typeof artifact[field] !== 'string' || !artifact[field].trim()) throw new Error(`Local operator artifact ${index}.${field} must be a non-empty string.`);
    return artifact as unknown as Applik8sLocalOperatorArtifact;
  });
}
