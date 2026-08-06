import { app } from '@applik8s/applik8s';
import { Installation, InstallationStatus } from './installation';

export const application = app("identity-start", {
  namespace: applicationNamespace("identity-start"),
  spec: Installation,
  status: InstallationStatus,
});

function applicationNamespace(name: string): string {
  return `${name}-system`;
}
