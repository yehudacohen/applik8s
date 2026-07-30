import type {
  ApplicationAIConversationRecord,
  ApplicationAIMessageRecord,
  ApplicationAIProtocolRunRecord,
  ApplicationAIRunEventRecord,
} from '@applik8s/ai';
import type { JsonValue } from '@applik8s/core';

export interface ApplicationConversationPage<TValue> {
  readonly values: readonly TValue[];
  readonly nextCursor?: string;
}

export interface ApplicationConversationMessageInput {
  readonly id: string;
  readonly role: ApplicationAIMessageRecord['role'];
  readonly content: JsonValue;
  readonly state?: ApplicationAIMessageRecord['state'];
  readonly invocationId?: string;
  readonly createdAt: string;
}

export interface ApplicationConversationRunInput {
  readonly id: string;
  readonly conversationId: string;
  readonly principalScope: string;
  readonly agentRunId?: string;
  readonly invocationId?: string;
  readonly startedAt: string;
}

export interface ApplicationConversationStore {
  createConversation(
    conversation: ApplicationAIConversationRecord,
  ): Promise<ApplicationAIConversationRecord>;
  getConversation(
    id: string,
    principalScope: string,
  ): Promise<ApplicationAIConversationRecord | undefined>;
  appendMessage(input: {
    readonly conversationId: string;
    readonly principalScope: string;
    readonly expectedRevision: number;
    readonly message: ApplicationConversationMessageInput;
  }): Promise<{
    readonly conversation: ApplicationAIConversationRecord;
    readonly message: ApplicationAIMessageRecord;
  }>;
  listMessages(input: {
    readonly conversationId: string;
    readonly principalScope: string;
    readonly afterRevision?: number;
    readonly limit: number;
  }): Promise<readonly ApplicationAIMessageRecord[]>;
  startRun(
    run: ApplicationConversationRunInput,
  ): Promise<ApplicationAIProtocolRunRecord>;
  transitionRun(input: {
    readonly runId: string;
    readonly principalScope: string;
    readonly from: ApplicationAIProtocolRunRecord['status'];
    readonly to: ApplicationAIProtocolRunRecord['status'];
    readonly updatedAt: string;
  }): Promise<ApplicationAIProtocolRunRecord>;
  appendRunEvent(input: {
    readonly runId: string;
    readonly principalScope: string;
    readonly expectedSequence: number;
    readonly event: Omit<ApplicationAIRunEventRecord, 'runId' | 'sequence'>;
  }): Promise<ApplicationAIRunEventRecord>;
  listRunEvents(input: {
    readonly runId: string;
    readonly principalScope: string;
    readonly afterSequence?: number;
    readonly limit: number;
    readonly visibility?: ApplicationAIRunEventRecord['visibility'];
  }): Promise<readonly ApplicationAIRunEventRecord[]>;
}

export class ApplicationConversationConflictError extends Error {
  readonly code = 'CONVERSATION_CONFLICT';

  constructor(message: string) {
    super(message);
    this.name = 'ApplicationConversationConflictError';
  }
}
