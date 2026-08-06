import { AsyncLocalStorage } from 'node:async_hooks';
import {
  type ApplicationManagedEffects,
  installApplicationManagedEffectsResolver,
} from './application-managed-effects-api.js';

const managedEffects = new AsyncLocalStorage<ApplicationManagedEffects>();

installApplicationManagedEffectsResolver(() => managedEffects.getStore());

export function withApplicationManagedEffects<TResult>(
  effects: ApplicationManagedEffects,
  run: () => TResult,
): TResult {
  return managedEffects.run(effects, run);
}
