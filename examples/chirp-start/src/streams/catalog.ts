import { app } from '../domain-app';
import { Post } from '../domain/post';

/**
 * The application event catalog derives one typed stream from every committed
 * Post lifecycle fact. Consumers see a stable envelope carrying contract and
 * producer identity instead of hand-maintaining another event union.
 */
export const PostLifecycleFacts = app.events.from(Post);

/**
 * `of(...)` is the precise form when a feature wants only selected facts from
 * a producer. Both selections remain backed by Post's authoritative outbox.
 */
export const PostWriteFacts = app.events.of(
  Post.events.created,
  Post.events.updated,
);
