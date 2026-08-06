import { app } from './installation';
import './providers/identity';
import './providers';

/**
 * The application root is intentionally boring: installation shape,
 * identity, and infrastructure providers are organized independently while
 * feature modules import one fully assembled application.
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
export { authenticateChirpRequest } from './providers/identity';
