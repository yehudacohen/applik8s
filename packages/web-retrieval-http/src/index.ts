import type { ApplicationSourceRetrieverProvider } from '@applik8s/web-search';
import { bindApplicationSourceRetrieverRuntime } from '@applik8s/web-search/runtime-contract';
import { createBoundedHttpSourceRetriever } from './runtime.js';
import {
  normalizeBoundedHttpSourceRetrieverOptions,
  type BoundedHttpSourceRetrieverOptions,
} from './policy.js';

export type { BoundedHttpSourceRetrieverOptions } from './policy.js';
export { normalizeBoundedHttpSourceRetrieverOptions } from './policy.js';

export interface BoundedHttpSourceRetrieverProvider extends ApplicationSourceRetrieverProvider {
  readonly kind: 'bounded-http-source-retriever';
  readonly mode: 'live';
  readonly policy: Readonly<Required<BoundedHttpSourceRetrieverOptions>>;
}

export const BoundedHttpSourceRetriever = Object.freeze({
  create(options: BoundedHttpSourceRetrieverOptions = {}): BoundedHttpSourceRetrieverProvider {
    const policy = normalizeBoundedHttpSourceRetrieverOptions(options);
    const implementation: BoundedHttpSourceRetrieverProvider = {
      provider: 'bounded-http',
      kind: 'bounded-http-source-retriever',
      mode: 'live',
      policy,
      retrieve: createBoundedHttpSourceRetriever(policy),
    };
    return Object.freeze(bindApplicationSourceRetrieverRuntime(implementation, {
      env: {
        APPLIK8S_SOURCE_RETRIEVER_KIND: 'bounded-http',
        APPLIK8S_SOURCE_RETRIEVER_POLICY: JSON.stringify(policy),
      },
    }));
  },
});
