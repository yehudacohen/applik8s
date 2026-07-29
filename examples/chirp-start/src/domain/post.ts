import { HomeTimeline } from '../streams/timeline';
import { registerPostViews } from './posts';

/** Canonical Post facade assembled after its online projection is registered. */
export const Post = registerPostViews(HomeTimeline);
