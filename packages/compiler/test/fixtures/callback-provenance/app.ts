import { RequestIdentity } from '@applik8s/applik8s';
import { authenticateRequest } from './identity';

export const identity = RequestIdentity.from(authenticateRequest);
