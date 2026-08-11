import { billing } from '@applik8s/billing';
import { application } from './application-provider-root';
import { providers } from './application-provider-profile';

export const primaryStore = providers.database;
export const Billing = application.include(billing);
