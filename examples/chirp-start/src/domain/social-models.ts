import { app } from '../app';
import { bookmarks, reactions } from '../schema/social';
import { ChirpCommandProcessor, Database } from '../providers/database';

/**
 * Foundational social models are declared separately from their policies so
 * post views can declare their authoritative engagement dependencies without
 * introducing a Post -> social policies -> Post module cycle.
 */
export const ReactionModel = app.model(reactions, {
  name: 'Reaction',
  database: Database,
  processor: ChirpCommandProcessor,
});

export const BookmarkModel = app.model(bookmarks, {
  name: 'Bookmark',
  database: Database,
  processor: ChirpCommandProcessor,
});
