/** Public application-domain barrel shared by SSR, routes, workers, and tests. */

export { executeAutomationRun, generatePost, moderatePost, prepareAutomationPost, scorePost } from './automation/workflow';
export { Account, AccountCreationGuard, CredentialLink, InstallationSetting } from './domain/accounts';
export { Automation, AutomationControl, AutomationRun } from './domain/automation';
export * from './domain/events';
export { Media } from './domain/media';
export { ModerationCase, ModerationPolicy, Report } from './domain/moderation';
export { Notification } from './domain/notifications';
export { Post } from './domain/post';
export { Block, Follow, Mute } from './domain/relationships';
export { Bookmark, Reaction } from './domain/social';
export { TimelinePost, type TimelinePost as TimelinePostValue } from './domain/timeline-contract';
export { accountGateway, administrationGateway, gateway, socialGateway } from './gateway';
export { Attachments, Avatars, ProjectionArtifacts } from './media/objects';
export { Database } from './providers/database';
export { DefaultModerationPolicy } from './providers/moderation';
export { buildHomeTimelineGeneration, RebuildHomeTimelines } from './recovery/timeline';
export { AutomationScheduleChanges, AutomationScheduleReconciler } from './streams/automation';
export { FollowChanges, ReactionChanges } from './streams/engagement';
export { MediaUploads, MediaVerification } from './streams/media';
export { PostTimelineChanges, PublishedPosts } from './streams/post-stream';
export { PostAnalytics, PostDeletionLifecycle, PostPublicationLifecycle, PostUpdateLifecycle } from './streams/publication';
export { HomeTimeline } from './streams/timeline';
