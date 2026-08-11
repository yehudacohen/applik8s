import { createTenantPlatformV05Example } from './tenant-platform.js';

/**
 * Compiler entrypoint for the historical v0.5 pressure test. Keeping this
 * materialization separate makes importing the reusable fixture side-effect
 * free while the compiler can instrument its complete local helper graph.
 */
export const tenantPlatformV05 =
  createTenantPlatformV05Example().composition;
