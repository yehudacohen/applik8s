import { basename, resolve } from 'node:path';
import type {
  Applik8sError,
  OperatorDefinition,
  Result,
} from '@applik8s/core';
import type {
  CompileOperatorRequest,
} from './index.js';
import type { OperatorArtifacts } from '../interfaces.js';
import {
  discoverExportedOperators,
  type TypeKroCompositionExport,
} from './entrypoint-discovery.js';

export function outputDirectory(
  request: Pick<CompileOperatorRequest, 'outDir'>,
): string {
  return resolve(request.outDir ?? 'dist/applik8s');
}

export async function discoverAndSelectOperator(
  entrypoint: string,
  operatorName?: string,
): Promise<Result<OperatorDefinition>> {
  const discovered = await discoverExportedOperators(entrypoint);
  return discovered.ok
    ? selectOperator(discovered.value.operators, operatorName)
    : discovered;
}

export function selectProvidedOperator(
  operator: OperatorDefinition,
  operatorName?: string,
): Result<OperatorDefinition> {
  if (operatorName && operator.name !== operatorName) {
    return error(
      `Provided operator ${operator.name} does not match requested operator ${operatorName}.`,
    );
  }
  return { ok: true, value: operator };
}

export function selectTypeKroComposition(
  compositions: readonly TypeKroCompositionExport[],
  compositionName?: string,
): Result<TypeKroCompositionExport> {
  if (compositionName) {
    const selected = compositions.find(
      (composition) => composition.name === compositionName,
    );
    return selected
      ? { ok: true, value: selected }
      : error(
          `Entrypoint does not export a TypeKro composition named ${compositionName}. Available compositions: ${availableNames(compositions.map((composition) => composition.name))}.`,
        );
  }
  const onlyComposition = compositions.length === 1 ? compositions[0] : undefined;
  if (onlyComposition) return { ok: true, value: onlyComposition };
  if (compositions.length === 0) {
    return error('Entrypoint does not export a TypeKro composition.');
  }
  return error(
    `Entrypoint exports multiple TypeKro compositions (${availableNames(compositions.map((composition) => composition.name))}); set compositionName explicitly.`,
  );
}

export function isOperatorDefinitionLike(
  value: unknown,
): value is OperatorDefinition {
  return Boolean(
    value
      && typeof value === 'object'
      && typeof Reflect.get(value, 'name') === 'string'
      && isObject(Reflect.get(value, 'resources'))
      && Array.isArray(Reflect.get(value, 'handlers')),
  );
}

export function artifactsFromPaths(
  manifestJsonPath: string,
  handlerWasmPath: string,
  handlerWitPath: string,
  kubernetesPaths: readonly string[],
  generatedImageDockerfilePath?: string,
  generatedApplyScriptPath?: string,
  sourceMapPath?: string,
): OperatorArtifacts {
  const pathFor = (prefix: string): string => {
    const path = kubernetesPaths.find((candidate) =>
      basename(candidate).startsWith(prefix),
    );
    if (!path) {
      throw new Error(
        `Generated Kubernetes artifact set is missing ${prefix}*.yaml.`,
      );
    }
    return path;
  };
  const crds = kubernetesPaths.filter((path) =>
    basename(path).startsWith('customresourcedefinition-'),
  );
  const rbac =
    kubernetesPaths.find((path) =>
      /^(clusterrole|role)-/.test(basename(path)),
    )
    ?? pathFor('rolebinding-');
  const configMap =
    kubernetesPaths.find((path) => basename(path).startsWith('configmap-'))
    ?? pathFor('deployment-');
  return {
    manifestJsonPath,
    handlerWasmPath,
    handlerWitPath,
    generatedCrdYamlPaths: crds,
    generatedRbacYamlPath: rbac,
    generatedServiceAccountYamlPath: pathFor('serviceaccount-'),
    generatedDeploymentYamlPath: pathFor('deployment-'),
    generatedConfigMapYamlPath: configMap,
    ...(generatedImageDockerfilePath ? { generatedImageDockerfilePath } : {}),
    ...(generatedApplyScriptPath ? { generatedApplyScriptPath } : {}),
    ...(sourceMapPath ? { sourceMapPath } : {}),
  };
}

function selectOperator(
  operators: readonly OperatorDefinition[],
  operatorName?: string,
): Result<OperatorDefinition> {
  if (operatorName) {
    const selected = operators.find((operator) => operator.name === operatorName);
    return selected
      ? { ok: true, value: selected }
      : error(
          `Entrypoint does not export an operator named ${operatorName}. Available operators: ${availableNames(operators.map((operator) => operator.name))}.`,
        );
  }
  const onlyOperator = operators.length === 1 ? operators[0] : undefined;
  if (onlyOperator) return { ok: true, value: onlyOperator };
  if (operators.length === 0) return error('Entrypoint does not export an operator.');
  return error(
    `Entrypoint exports multiple operators (${availableNames(operators.map((operator) => operator.name))}); set operatorName explicitly.`,
  );
}

function availableNames(values: readonly (string | undefined)[]): string {
  const names = values.filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  return names.length > 0 ? names.join(', ') : '<none>';
}

function isObject(value: unknown): value is object {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function error<T = never>(message: string): Result<T> {
  const diagnostic: Applik8sError = {
    code: 'BUNDLE_INVALID',
    message,
    severity: 'error',
    context: {},
    recovery: { summary: message },
  };
  return { ok: false, error: diagnostic };
}
