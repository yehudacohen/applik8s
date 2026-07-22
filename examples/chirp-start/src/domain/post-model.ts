import { app } from '../app';
import { posts } from '../schema/posts';
import { ChirpCommandProcessor, Database } from '../providers/database';

/** Shared promoted authority used by commands, views, streams, and rebuilds. */
export const PostBase = app.model(posts, { name: 'Post', database: Database, processor: ChirpCommandProcessor });
