import { IdentityProvider } from '@applik8s/applik8s';
import { authenticateRequest } from './identity';

export const identity = IdentityProvider.from(authenticateRequest);
