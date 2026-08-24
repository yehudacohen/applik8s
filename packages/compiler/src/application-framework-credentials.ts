import type {
  ApplicationFrameworkCredentialDependency,
  ApplicationFrameworkCredentialKind,
} from '@applik8s/deployment-contract';
import { applicationFrameworkCredentialEnvironmentIsValid } from '@applik8s/deployment-contract';

const FRAMEWORK_CREDENTIAL_ENVIRONMENTS = {
  APPLIK8S_AGENT_QUERY_CONTEXT_SECRET: 'agent-query-context',
  APPLIK8S_CONTEXT_SECRET: 'context',
  APPLIK8S_CURSOR_SECRET: 'cursor',
  APPLIK8S_HTTP_CONTEXT_SECRET: 'http-context',
  APPLIK8S_INTERNAL_OPERATION_SECRET: 'internal-operation',
  APPLIK8S_LOCAL_RESOURCE_TOKEN: 'local-resource',
  APPLIK8S_TASK_OPERATION_CONTEXT_SECRET: 'task-operation-context',
  APPLIK8S_TASK_QUERY_CONTEXT_SECRET: 'task-query-context',
} as const satisfies Readonly<Record<string, ApplicationFrameworkCredentialKind>>;

/**
 * Captures the exact framework credential names referenced by one generated
 * executable. This runs on compiler-owned output, not arbitrary application
 * source, and produces the portable authority contract consumed by every
 * deployment target.
 *
 * `additional` covers compiler-supported renamed credentials such as a
 * lakehouse cursor key. Callers must still assign one of the closed semantic
 * kinds; arbitrary ambient environment access cannot enter this contract.
 */
export function applicationFrameworkCredentialDependencies(
  generatedSource: string,
  additional: Readonly<Record<string, ApplicationFrameworkCredentialKind>> = {},
): readonly ApplicationFrameworkCredentialDependency[] {
  const candidates: Readonly<Record<string, ApplicationFrameworkCredentialKind>> = {
    ...FRAMEWORK_CREDENTIAL_ENVIRONMENTS,
    ...additional,
  };
  const dependencies = Object.entries(candidates)
    .filter(([environmentName]) => generatedSource.includes(environmentName))
    .map(([environmentName, kind]) => ({ kind, environmentName }))
    .sort((left, right) => left.environmentName.localeCompare(right.environmentName));
  for (const dependency of dependencies) {
    if (!applicationFrameworkCredentialEnvironmentIsValid(dependency)) {
      throw new Error(`Generated framework credential ${dependency.kind} uses unsafe environment name ${JSON.stringify(dependency.environmentName)}.`);
    }
  }
  return dependencies;
}
