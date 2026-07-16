import type { ApplicationGraph } from '@applik8s/core';
import { emitGeneratedApplicationHost } from '../application-host/index.js';

export function typeKroKubectlContextShell(): readonly string[] {
  return [
    'kubectl_run() {',
    '  if [ -n "$KUBE_CONTEXT" ]; then',
    '    "$KUBECTL" --context "$KUBE_CONTEXT" "$@"',
    '  else',
    '    "$KUBECTL" "$@"',
    '  fi',
    '}',
    '',
  ];
}

export async function generatedApplicationHostResources(options: {
  readonly graph: ApplicationGraph;
  readonly entrypoint: string;
  readonly outDir: string;
}): Promise<readonly unknown[]> {
  return emitGeneratedApplicationHost(options);
}
