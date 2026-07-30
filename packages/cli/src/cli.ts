#!/usr/bin/env node

/**
 * Stable CLI library surface. Command routing and process handoffs live behind
 * this intentionally small module so importing the CLI never executes it.
 */
export * from './cli-implementation.js';
