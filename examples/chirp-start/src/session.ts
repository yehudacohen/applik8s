import { AccountMe } from './application';

/**
 * One authenticated, provider-neutral session projection. The browser never
 * supplies an actor identifier; every gateway resolves this view from the
 * admitted principal and authorization version.
 */
export const currentAccount = AccountMe();
