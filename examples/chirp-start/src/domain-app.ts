import { app } from './installation';

/**
 * Lightweight domain authoring surface. Runtime routes and model modules use
 * this boundary without evaluating the deployment-provider assembly in
 * `app.ts`.
 */
export const workflow = app.workflow;

export {
  app,
  capacity,
  ChirpInstallation,
  mediaBucket,
  namespace,
  publicExposure,
} from './installation';
