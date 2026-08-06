import { ApplicationOperationsControlCenter } from '@applik8s/operations-ui/react';
import { createFileRoute } from '@tanstack/react-router';
import { OperationsSnapshot } from '../application';

export const Route = createFileRoute('/operations')({
  component: () => (
    <ApplicationOperationsControlCenter
      snapshot={OperationsSnapshot}
      title="Identity Start operations"
    />
  ),
});
