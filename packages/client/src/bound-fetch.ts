/**
 * Captures a Fetch implementation with the browser global as its receiver.
 *
 * Chromium's `window.fetch` is a Web IDL method and throws an illegal-invocation
 * error when it is extracted and later called as a plain function. Node and test
 * doubles generally tolerate that shape, which made the browser-only failure
 * easy to miss.
 */
export function boundFetch(implementation: typeof globalThis.fetch = globalThis.fetch): typeof globalThis.fetch {
  return implementation.bind(globalThis);
}
