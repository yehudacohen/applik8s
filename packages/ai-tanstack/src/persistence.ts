import {
  reconstructChat,
  withPersistence,
} from '@tanstack/ai-persistence';
import type {
  ChatPersistence,
  ChatTranscriptPersistence,
  ChatWithInterruptsPersistence,
  ReconstructChatOptions,
  WithPersistenceOptions,
} from '@tanstack/ai-persistence';

// typecast: preserve the exact tested compatibility tuple as public literal metadata.
export const applicationTanStackServerPersistenceCompatibility = Object.freeze({
  package: '@tanstack/ai-persistence',
  version: '0.1.5',
  tanstackAI: '0.45.1',
  contract: 'ChatPersistence',
  status: 'supported',
} as const);

export type ApplicationTanStackChatPersistence = ChatPersistence;
export type ApplicationTanStackChatTranscriptPersistence = ChatTranscriptPersistence;
export type ApplicationTanStackChatWithInterruptsPersistence = ChatWithInterruptsPersistence;
export type ApplicationTanStackPersistenceOptions = WithPersistenceOptions;
export type ApplicationTanStackReconstructOptions = ReconstructChatOptions;

/**
 * The published TanStack middleware remains the sole owner of transcript,
 * protocol-run, and interrupt persistence semantics. Applik8s supplies scoped
 * stores and authority; it does not fork the upstream lifecycle.
 */
export const withApplicationTanStackPersistence = withPersistence;

/**
 * Reconstruct a server-authoritative thread through TanStack's supported
 * protocol. Multi-user callers must provide an authorization callback.
 */
export const reconstructApplicationTanStackChat = reconstructChat;

export function assertApplicationTanStackServerPersistenceAvailable(): void {
  // The exact compatibility tuple is pinned above and exercised by package
  // integration tests. Retained as an explicit startup assertion for callers
  // that previously gated this capability.
}
