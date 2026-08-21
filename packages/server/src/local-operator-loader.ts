export async function resolve(specifier: string, context: object, nextResolve: (specifier: string, context: object) => Promise<unknown>): Promise<unknown> {
  if (specifier === 'applik8s:handler/kubernetes') return { url: 'applik8s-local:handler-kubernetes', shortCircuit: true };
  if (specifier === 'applik8s:handler/capabilities') return { url: 'applik8s-local:handler-capabilities', shortCircuit: true };
  return nextResolve(specifier, context);
}

export async function load(url: string, context: object, nextLoad: (url: string, context: object) => Promise<unknown>): Promise<unknown> {
  if (url === 'applik8s-local:handler-kubernetes') return bridgeModule('kubernetesRead');
  if (url === 'applik8s-local:handler-capabilities') return bridgeModule('capabilityRequest');
  return nextLoad(url, context);
}

function bridgeModule(name: 'kubernetesRead' | 'capabilityRequest'): object {
  return {
    format: 'module',
    shortCircuit: true,
    source: `const bridge = globalThis[Symbol.for('applik8s.localOperatorHost')];
if (!bridge || typeof bridge.${name} !== 'function') throw new Error('Applik8s local operator host bridge is unavailable.');
export const ${name} = (request) => bridge.${name}(request);`,
  };
}
