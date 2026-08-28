// typecast-file-boundary: Actor dependency discovery reflects branded callable handles and restores generics only after runtime-contract validation.
import {
  getApplicationOperationContract,
  type ApplicationOperationLike,
} from '@applik8s/client';
import type { ApplicationActorNode } from '@applik8s/core';
import type { ExpandedApplicationCallbackDependencies } from './application-callback.js';
import type { ApplicationGraphState } from './application-graph-state.js';

export interface ApplicationActorDependencyBinding {
  readonly alias: string;
  readonly actor: { readonly nodeId: string };
  readonly actorId: string;
  readonly member: string;
  readonly memberKind: 'command' | 'message' | 'alarm';
}

/**
 * Returns the provider-neutral actor identity carried by a decorated actor
 * command, message-send, or alarm-schedule function.
 */
export function applicationActorOperationReference(
  candidate: unknown,
): { readonly actorId: string; readonly member: string } | undefined {
  if (typeof candidate !== 'function') return undefined;
  const contract = getApplicationOperationContract(
    candidate as unknown as ApplicationOperationLike,
  );
  if (!contract || contract.transport !== 'runtime') return undefined;
  const match = /^applik8s:\/\/actors\/([^/]+)\/operations\/([^/]+)$/u.exec(
    contract.id,
  );
  return match?.[1] && match[2]
    ? { actorId: match[1], member: match[2] }
    : undefined;
}

/**
 * Resolves compiler-discovered actor callables to exact graph members. The
 * authored callback keeps its ordinary captured identifier; providers receive
 * only the corresponding actor/member binding.
 */
export function applicationActorDependencyBindings(
  state: ApplicationGraphState,
  consumer: string,
  dependencies: Pick<ExpandedApplicationCallbackDependencies, 'calls' | 'bindings'>,
): readonly ApplicationActorDependencyBinding[] {
  const bindings = new Map<string, ApplicationActorDependencyBinding>();
  for (const candidate of dependencies.calls) {
    const reference = applicationActorOperationReference(candidate);
    if (!reference) continue;
    const actor = state.graphNodes.find(
      (node): node is ApplicationActorNode =>
        node.kind === 'actor' && node.definition.id === reference.actorId,
    );
    if (!actor) {
      throw new Error(
        `${consumer} calls actor ${reference.actorId}.${reference.member}, but actor ${reference.actorId} is not declared before this callback.`,
      );
    }
    const member = actor.definition.protocol.find(
      (entry) => entry.name === reference.member,
    );
    if (!member || !['command', 'message', 'alarm'].includes(member.kind)) {
      throw new Error(
        `${consumer} calls unsupported actor member ${reference.actorId}.${reference.member}. Managed effect callbacks may call commands, send messages, or schedule alarms.`,
      );
    }
    const aliases = Object.entries(dependencies.bindings)
      .filter(
        ([identifier, value]) =>
          value === candidate && !/^generatedCall\d+$/u.test(identifier),
      )
      .map(([identifier]) => identifier)
      .sort();
    if (aliases.length === 0) {
      throw new Error(
        `${consumer} calls actor ${reference.actorId}.${reference.member} without a stable captured identifier. Import or bind the actor member with a module-level name.`,
      );
    }
    for (const alias of aliases) {
      const previous = bindings.get(alias);
      if (
        previous
        && (previous.actor.nodeId !== actor.id || previous.member !== reference.member)
      ) {
        throw new Error(
          `${consumer} actor identifier ${alias} is ambiguous between ${previous.actorId}.${previous.member} and ${reference.actorId}.${reference.member}.`,
        );
      }
      bindings.set(alias, {
        alias,
        actor: { nodeId: actor.id },
        actorId: reference.actorId,
        member: reference.member,
        memberKind: member.kind as 'command' | 'message' | 'alarm',
      });
    }
  }
  return [...bindings.values()].sort((left, right) =>
    left.alias.localeCompare(right.alias),
  );
}
// typecast-file-boundary: Actor dependency discovery reflects branded callable handles and restores generics only after runtime-contract validation.
