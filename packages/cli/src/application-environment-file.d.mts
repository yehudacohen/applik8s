/**
 * Load layered application-root environment files without exposing their
 * names or values through deployment diagnostics.
 */
export function loadApplicationEnvironmentFile(cwd: string): Promise<boolean>;
