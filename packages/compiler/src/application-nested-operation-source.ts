// typecast-file-boundary: Nested operation source builders restore literal discriminants on graph-validated command and event contracts for generated runtime facades.
import { createHash } from 'node:crypto';
import type {
  ApplicationCommandNode,
  ApplicationEventNode,
  ApplicationGraph,
} from '@applik8s/core';

export function nestedApplicationEventDefinition(event: ApplicationEventNode) {
  return {
    kind: 'applik8sEvent' as const,
    id: `${event.contract.name}.${event.contract.version}`,
    name: event.contract.name,
    version: event.contract.version,
    payload: {
      kind: 'jsonSchema' as const,
      ref: {
        kind: 'jsonSchema' as const,
        uri: `generated:${event.id}.payload`,
      },
      schema: event.contract.payload.jsonSchema,
    },
  };
}

export function nestedApplicationCommandDefinition(
  command: ApplicationCommandNode,
) {
  return {
    kind: 'applik8sCommand' as const,
    id: `${command.contract.name}.${command.contract.version}`,
    name: command.contract.name,
    version: command.contract.version,
    input: {
      kind: 'jsonSchema' as const,
      ref: {
        kind: 'jsonSchema' as const,
        uri: `generated:${command.id}.input`,
      },
      schema: command.contract.input.jsonSchema,
    },
    output: {
      kind: 'jsonSchema' as const,
      ref: {
        kind: 'jsonSchema' as const,
        uri: `generated:${command.id}.output`,
      },
      schema: command.contract.output.jsonSchema,
    },
    errors: Object.fromEntries(command.contract.errors.map((error) => [
      error.name,
      {
        kind: 'jsonSchema' as const,
        ref: {
          kind: 'jsonSchema' as const,
          uri: `generated:${command.id}.errors.${error.name}`,
        },
        schema: error.schema.jsonSchema,
      },
    ])),
  };
}

export function nestedApplicationCallbackVariable(identifier: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(identifier)
    ? identifier
    : `nestedBinding_${createHash('sha256').update(identifier).digest('hex').slice(0, 12)}`;
}

export function nestedApplicationCallbackObjectSource(
  entries: readonly { readonly path: string; readonly value: string }[],
): string {
  interface Node {
    direct?: string;
    readonly children: Map<string, Node>;
  }
  const root: Node = { children: new Map() };
  for (const entry of entries) {
    const segments = entry.path.split('.');
    if (
      segments.length === 0
      || segments.some(
        (segment) => !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment),
      )
    ) {
      continue;
    }
    let current = root;
    for (const segment of segments) {
      const child = current.children.get(segment) ?? {
        children: new Map<string, Node>(),
      };
      current.children.set(segment, child);
      current = child;
    }
    current.direct = entry.value;
  }
  const render = (node: Node): string => {
    if (node.direct && node.children.size === 0) return node.direct;
    const values = [
      ...(node.direct ? [`...(${node.direct})`] : []),
      ...[...node.children.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(
          ([property, child]) => `${JSON.stringify(property)}: ${render(child)}`,
        ),
    ];
    return `{ ${values.join(', ')} }`;
  };
  return render(root);
}

export function requiredApplicationGraphNode<
  TKind extends ApplicationGraph['nodes'][number]['kind'],
>(
  nodes: ReadonlyMap<string, ApplicationGraph['nodes'][number]>,
  id: string,
  kind: TKind,
  owner: string,
): Extract<ApplicationGraph['nodes'][number], { readonly kind: TKind }> {
  const node = nodes.get(id);
  if (node?.kind !== kind) {
    throw new Error(`${owner} references missing ${kind} ${id}.`);
  }
  // typecast: the runtime discriminant check narrows the graph union.
  return node as Extract<
    ApplicationGraph['nodes'][number],
    { readonly kind: TKind }
  >;
}
