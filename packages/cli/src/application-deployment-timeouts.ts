/**
 * Large namespaces may need one controller pass to retire provider finalizers
 * and a second to observe absence and retire the namespace finalizer.
 */
export const APPLICATION_DEPLOYMENT_TIMEOUT_MS = 20 * 60_000;
