import { bookmarks, reactions } from '../schema/social';

/**
 * Pure table identities are declared separately from their policies so post
 * views can capture authoritative engagement dependencies without importing
 * either the policy cycle or the application/provider graph.
 */
export const ReactionModel = reactions;
export const BookmarkModel = bookmarks;
