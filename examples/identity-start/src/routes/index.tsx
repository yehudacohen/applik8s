import { createFileRoute } from '@tanstack/react-router';
import { IdentityAcceptanceHome } from '../features/access/view';

export const Route = createFileRoute('/')({
  component: IdentityAcceptanceHome,
});
