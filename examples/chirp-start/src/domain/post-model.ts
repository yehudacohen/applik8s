import { posts } from '../schema/posts';

/**
 * Pure schema identity shared by callbacks and projections. Feature modules
 * import the Database binding explicitly when they need the promoted runtime
 * facet, keeping generated query callbacks free of the authoring graph.
 */
export const PostBase = posts;
