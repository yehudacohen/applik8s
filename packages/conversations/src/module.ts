import type {
  ApplicationDatabaseBinding,
  KubernetesApplicationBuilder,
} from '@applik8s/applik8s';
import {
  applicationConversationMemory,
  applicationConversationMessages,
  applicationConversationRunEvents,
  applicationConversationRuns,
  applicationConversations,
} from './schema.js';

export interface ApplicationConversationsModuleOptions {
  readonly database?: ApplicationDatabaseBinding;
}

export function conversations(
  application: Pick<KubernetesApplicationBuilder, 'model'>,
  options: ApplicationConversationsModuleOptions = {},
) {
  const modelOptions = options.database
    ? { database: options.database }
    : undefined;
  const Conversation = application.model(applicationConversations, {
    ...modelOptions,
    name: 'Conversation',
    revision: false,
  });
  const Message = application.model(applicationConversationMessages, {
    ...modelOptions,
    name: 'Message',
    revision: false,
  });
  const ProtocolRun = application.model(applicationConversationRuns, {
    ...modelOptions,
    name: 'ProtocolRun',
    revision: false,
  });
  const RunEvent = application.model(applicationConversationRunEvents, {
    ...modelOptions,
    name: 'RunEvent',
    revision: false,
  });
  const Memory = application.model(applicationConversationMemory, {
    ...modelOptions,
    name: 'Memory',
    revision: false,
  });

  return Object.freeze({
    Conversation,
    Message,
    ProtocolRun,
    RunEvent,
    Memory,
  });
}
