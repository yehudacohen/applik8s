import {
  type ApplicationRelationalModel,
  module,
} from '@applik8s/applik8s';
import {
  applicationConversationMemory,
  applicationConversationMessages,
  applicationConversationRunEvents,
  applicationConversationRuns,
  applicationConversations,
  applicationConversationSchema,
} from './schema.js';

function installConversations() {
  return {
    // The declaration is still the one Drizzle table. app.include() registers
    // the module schema before invoking this installer, so the returned value
    // has its collision-safe model methods by the time another maintained
    // module composes it. Preserve that promoted type across package
    // declaration emission instead of forcing consumers to promote it again.
    // app.include() performs promotion before installation.
    // typecast: the table retains that promoted identity through composition.
    Conversation: applicationConversations as ApplicationRelationalModel<
      typeof applicationConversations
    >,
    Message: applicationConversationMessages,
    ProtocolRun: applicationConversationRuns,
    RunEvent: applicationConversationRunEvents,
    Memory: applicationConversationMemory,
  };
}

export const conversations = module(
  'conversations',
  { schema: applicationConversationSchema },
  installConversations,
);
