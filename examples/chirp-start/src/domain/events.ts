import { event, type } from '@applik8s/applik8s/dsl';

export const AccountChanged = event('accounts.changed.v1', {
  payload: type({ accountId: 'string', handle: 'string', kind: "'human' | 'automation'", state: "'active' | 'suspended'", changedAt: 'string' }),
});

export const PostPublished = event('posts.published.v1', {
  payload: type({
    postId: 'string', authorId: 'string', authorHandle: 'string', body: 'string',
    publishedAt: 'string', visibility: 'string',
    'replyToPostId?': 'string', 'quotePostId?': 'string',
  }),
});

export const PostDeleted = event('posts.deleted.v1', {
  payload: type({ postId: 'string', authorId: 'string', deletedAt: 'string' }),
});

export const PostModerationChanged = event('posts.moderation-changed.v1', {
  payload: type({ postId: 'string', state: "'visible' | 'limited' | 'removed'", changedAt: 'string', reason: 'string' }),
});

/** Unified upsert/tombstone vocabulary for every online post projection. */
export const PostTimelineChanged = event('posts.timeline-changed.v1', {
  payload: type({
    operation: "'upsert' | 'remove'", postId: 'string', authorId: 'string', authorHandle: 'string', body: 'string',
    publishedAt: 'string', visibility: 'string', replyToPostId: 'string | null', quotePostId: 'string | null',
  }),
});

export const FollowChanged = event('follows.changed.v1', {
  payload: type({ followId: 'string', followerId: 'string', followeeId: 'string', state: "'active' | 'deleted'", changedAt: 'string' }),
});

export const ReactionChanged = event('reactions.changed.v1', {
  payload: type({ reactionId: 'string', accountId: 'string', postId: 'string', kind: "'like' | 'repost'", state: "'active' | 'deleted'", changedAt: 'string' }),
});

export const BookmarkChanged = event('bookmarks.changed.v1', {
  payload: type({ bookmarkId: 'string', accountId: 'string', postId: 'string', state: "'saved' | 'removed'", changedAt: 'string' }),
});

export const RelationshipPolicyChanged = event('relationships.policy-changed.v1', {
  payload: type({ relationshipId: 'string', ownerId: 'string', subjectId: 'string', kind: "'block' | 'mute'", state: "'active' | 'removed'", changedAt: 'string' }),
});

export const NotificationRequested = event('notifications.requested.v1', {
  payload: type({ notificationId: 'string', recipientId: 'string', actorId: 'string', postId: 'string', kind: 'string', createdAt: 'string' }),
});

export const NotificationChanged = event('notifications.changed.v1', {
  payload: type({ notificationId: 'string', recipientId: 'string', state: "'delivered' | 'read'", changedAt: 'string' }),
});

export const ReportSubmitted = event('moderation.report-submitted.v1', {
  payload: type({ reportId: 'string', reporterId: 'string', targetType: "'post' | 'account'", targetId: 'string', createdAt: 'string' }),
});

export const ModerationCaseChanged = event('moderation.case-changed.v1', {
  payload: type({ caseId: 'string', reportId: 'string', state: "'open' | 'resolved'", changedAt: 'string', 'resolution?': 'string' }),
});

export const MediaUploadCompleted = event('media.upload-completed.v1', {
  payload: type({ attachmentId: 'string', ownerId: 'string', objectKey: 'string', contentType: 'string', byteLength: 'string', sha256: 'string', completedAt: 'string' }),
});

export const MediaProcessingChanged = event('media.processing-changed.v1', {
  payload: type({ attachmentId: 'string', ownerId: 'string', processingState: "'ready' | 'rejected'", reason: 'string', changedAt: 'string' }),
});

export const AutomationScheduleChanged = event('automations.schedule-changed.v1', {
  payload: type({
    automationId: 'string', ownerId: 'string', accountId: 'string', schedule: 'string', state: "'active' | 'suspended'", changedAt: 'string',
    'persona?': 'string', 'instructions?': 'string', 'generationProfile?': 'string', 'maxPostsPerDay?': 'string', 'maxUnitsPerDay?': 'string',
  }),
});

export const AutomationRunChanged = event('automations.run-changed.v1', {
  payload: type({ runId: 'string', automationId: 'string', state: "'scheduled' | 'running' | 'published' | 'rejected' | 'failed'", changedAt: 'string', 'postId?': 'string' }),
});
