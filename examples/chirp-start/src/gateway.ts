import { verifyApplicationObjectCompletionReceipt } from '@applik8s/applik8s';
import type { ApplicationPrincipal } from '@applik8s/core';
import { app, authenticateChirpRequest, capacity, namespace } from './app';
import { AutomationPostReviewRequests } from './automation/workflow';
import { Account, AccountByHandle, AccountDiscover, AccountMe, CredentialLink, InstallationSetting } from './domain/accounts';
import { Automation, AutomationControl, AutomationControlCurrent, AutomationMine, AutomationRun, AutomationRunRecent } from './domain/automation';
import { EngagementBatch, EngagementBatchRecent } from './domain/engagement';
import { Media, MediaForPosts } from './domain/media';
import { ModerationCase, ModerationCaseQueue, ModerationPolicyCurrent, Report, ReportOpenQueue } from './domain/moderation';
import { Notification, NotificationInbox } from './domain/notifications';
import { Post, PostByAuthor, PostByAuthorHandle, PostConversation, PostHomeTimeline, PostSearch, PostTrending } from './domain/post';
import { Block, BlockViewerState, Follow, FollowFollowers, FollowFollowing, FollowViewerState, Mute, MuteViewerState } from './domain/relationships';
import { Bookmark, BookmarkMine, Reaction } from './domain/social';

async function authenticatedAdmission({
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
  return await verifyApplicationObjectCompletionReceipt({
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

function moderatorAdmission({ principal, input }: { readonly principal: ApplicationPrincipal; readonly input: unknown }) {
  if (!principal.roles?.includes('moderator') || !input || typeof input !== 'object') return false;
  const moderatorId = Reflect.get(input, 'moderatorId');
  return moderatorId === undefined || moderatorId === principal.id;
}

function systemAdmission({ principal }: { readonly principal: ApplicationPrincipal }) {
  return principal.roles?.some((role) =>
    ['analytics-worker', 'automation-worker', 'engagement-batch-worker', 'identity-administrator', 'installation-administrator', 'notification-worker'].includes(role),
  ) === true;
}

/** The route multiplexer keeps these workload boundaries invisible to clients. */
export const socialGateway = app.gateway('social', {
  queries: [PostHomeTimeline, PostConversation, PostSearch, PostByAuthor, PostByAuthorHandle, PostTrending, FollowFollowers, FollowFollowing, FollowViewerState, BlockViewerState, MuteViewerState, BookmarkMine],
  commands: [Post.create, Post.update, Post.delete, Follow.create, Follow.update, Follow.delete, Reaction.create, Reaction.update, Reaction.delete, Bookmark.create, Bookmark.update, Bookmark.delete, Block.create, Block.update, Block.delete, Mute.create, Mute.update, Mute.delete, Report.create],
  authorizeCommand: authenticatedAdmission,
  deployment: {
    namespace, replicas: capacity.gatewayReplicas, port: 8080,
    cursorSecret: { name: 'chirp-gateway-cursor', key: 'key' },
    authenticate: authenticateChirpRequest,
  },
});

export const accountGateway = app.gateway('account', {
  queries: [AccountMe, AccountByHandle, AccountDiscover, NotificationInbox, MediaForPosts, AutomationMine, AutomationRunRecent],
  commands: [Account.create, Account.update, Account.delete, Notification.update, Notification.delete, Media.create, Media.update, Media.delete, Automation.create, Automation.update, Automation.delete],
  authorizeCommand: authenticatedAdmission,
  deployment: {
    namespace, replicas: capacity.gatewayReplicas, port: 8080,
    cursorSecret: { name: 'chirp-gateway-cursor', key: 'key' },
    authenticate: authenticateChirpRequest,
  },
});

export const administrationGateway = app.gateway('administration', {
  queries: [ReportOpenQueue, ModerationCaseQueue, ModerationPolicyCurrent, AutomationControlCurrent, EngagementBatchRecent],
  commands: [Report.update, Report.delete, ModerationCase.create, ModerationCase.update, ModerationCase.delete, AutomationControl.update, AutomationControl.delete],
  subscriptions: [AutomationPostReviewRequests],
  // Moderator workspaces keep several resumable views open together and may
  // be reloaded or opened in multiple tabs. Query leases are still bounded by
  // the framework session timeout; this budget admits that real topology
  // without weakening the cluster-wide ceiling.
  subscriptionLimits: { perPrincipal: 64, total: 1_000 },
  authorizeCommand: moderatorAdmission,
  deployment: {
    namespace, replicas: capacity.gatewayReplicas, port: 8080,
    cursorSecret: { name: 'chirp-gateway-cursor', key: 'key' },
    authenticate: authenticateChirpRequest,
  },
});

/** Service-principal-only mutations remain routed and auditable without exposing unguarded defaults. */
export const systemGateway = app.gateway('system', {
  visibility: 'internal',
  queries: [],
  commands: [AutomationRun.create, AutomationRun.update, AutomationRun.delete, CredentialLink.create, CredentialLink.update, CredentialLink.delete, EngagementBatch.create, InstallationSetting.create, InstallationSetting.update, InstallationSetting.delete, Notification.create],
  authorizeCommand: systemAdmission,
  deployment: {
    namespace, replicas: capacity.gatewayReplicas, port: 8080,
    cursorSecret: { name: 'chirp-gateway-cursor', key: 'key' },
    authenticate: authenticateChirpRequest,
  },
});

/** Compatibility name for example imports; public clients route by operation. */
export const gateway = socialGateway;
