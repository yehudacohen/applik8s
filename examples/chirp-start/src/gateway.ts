import { verifyApplicationObjectCompletionReceipt } from '@applik8s/applik8s';
import { app, authenticateChirpRequest, capacity, namespace } from './app';
import { Account, CredentialLink, InstallationSetting } from './domain/accounts';
import { Automation, AutomationControl, AutomationRun } from './domain/automation';
import { Media } from './domain/media';
import { ModerationCase, ModerationPolicy, Report } from './domain/moderation';
import { Notification } from './domain/notifications';
import { Post } from './domain/post';
import { Block, Follow, Mute } from './domain/relationships';
import { Bookmark, Reaction } from './domain/social';

function authenticatedAdmission({
  principal, authorizationVersion, command, input,
}: {
  readonly principal: { readonly id: string };
  readonly authorizationVersion: string;
  readonly command: string;
  readonly input: unknown;
}) {
  // The gateway establishes a trusted principal and rejects anonymous traffic.
  // Model beforeCommit policies own participant/actor authorization because
  // only they can distinguish an owner from a target such as Automation.accountId.
  if (!principal.id) return false;
  if (command !== Media.create.operation.id) return true;
  if (!input || typeof input !== 'object') return false;
  const byteLength = Number(Reflect.get(input, 'byteLength'));
  return verifyApplicationObjectCompletionReceipt({
    receipt: String(Reflect.get(input, 'uploadReceipt') ?? ''),
    secret: process.env.APPLIK8S_CURSOR_SECRET ?? '',
    principalId: principal.id,
    authorizationVersion,
    store: 'attachments',
    objectId: String(Reflect.get(input, 'id') ?? ''),
    key: String(Reflect.get(input, 'objectKey') ?? ''),
    contentType: String(Reflect.get(input, 'contentType') ?? ''),
    size: byteLength,
    sha256: String(Reflect.get(input, 'sha256') ?? ''),
  });
}

function moderatorAdmission({ principal, input }: { readonly principal: { readonly id: string; readonly claims?: Readonly<Record<string, unknown>> }; readonly input: unknown }) {
  if (principal.claims?.role !== 'moderator' || !input || typeof input !== 'object') return false;
  const moderatorId = Reflect.get(input, 'moderatorId');
  return moderatorId === undefined || moderatorId === principal.id;
}

function systemAdmission({ principal }: { readonly principal: { readonly id: string; readonly claims?: Readonly<Record<string, unknown>> } }) {
  return ['automation-worker', 'identity-administrator', 'installation-administrator', 'notification-worker'].includes(String(principal.claims?.role ?? ''));
}

/** The route multiplexer keeps these workload boundaries invisible to clients. */
export const socialGateway = app.gateway('social', {
  queries: [Post.homeTimeline, Post.conversation, Post.search, Post.byAuthor, Post.byAuthorHandle, Post.trending, Follow.followers, Follow.following, Follow.viewerState, Block.viewerState, Mute.viewerState, Bookmark.mine],
  commands: [Post.create, Post.update, Post.delete, Follow.create, Follow.update, Follow.delete, Reaction.create, Reaction.update, Reaction.delete, Bookmark.create, Bookmark.update, Bookmark.delete, Block.create, Block.update, Block.delete, Mute.create, Mute.update, Mute.delete, Report.create],
  authorizeCommand: authenticatedAdmission,
  deployment: {
    namespace, replicas: capacity.gatewayReplicas, port: 8080,
    cursorSecret: { name: 'chirp-gateway-cursor', key: 'key' },
    authenticate: authenticateChirpRequest,
  },
});

export const accountGateway = app.gateway('account', {
  queries: [Account.me, Account.byHandle, Account.discover, Notification.inbox, Media.forPosts, Automation.mine, AutomationRun.recent],
  commands: [Account.create, Account.update, Account.delete, Notification.update, Notification.delete, Media.create, Media.update, Media.delete, Automation.create, Automation.update, Automation.delete],
  authorizeCommand: authenticatedAdmission,
  deployment: {
    namespace, replicas: capacity.gatewayReplicas, port: 8080,
    cursorSecret: { name: 'chirp-gateway-cursor', key: 'key' },
    authenticate: authenticateChirpRequest,
  },
});

export const administrationGateway = app.gateway('administration', {
  queries: [Report.openQueue, ModerationCase.queue, ModerationPolicy.current, AutomationControl.current],
  commands: [Report.update, Report.delete, ModerationCase.create, ModerationCase.update, ModerationCase.delete, AutomationControl.create, AutomationControl.update, AutomationControl.delete],
  authorizeCommand: moderatorAdmission,
  deployment: {
    namespace, replicas: capacity.gatewayReplicas, port: 8080,
    cursorSecret: { name: 'chirp-gateway-cursor', key: 'key' },
    authenticate: authenticateChirpRequest,
  },
});

/** Service-principal-only mutations remain routed and auditable without exposing unguarded defaults. */
export const systemGateway = app.gateway('system', {
  queries: [],
  commands: [AutomationRun.create, AutomationRun.update, AutomationRun.delete, CredentialLink.create, CredentialLink.update, CredentialLink.delete, InstallationSetting.create, InstallationSetting.update, InstallationSetting.delete, Notification.create],
  authorizeCommand: systemAdmission,
  deployment: {
    namespace, replicas: capacity.gatewayReplicas, port: 8080,
    cursorSecret: { name: 'chirp-gateway-cursor', key: 'key' },
    authenticate: authenticateChirpRequest,
  },
});

/** Compatibility name for example imports; public clients route by operation. */
export const gateway = socialGateway;
