import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/readyz')({
  component: Ready,
});

function Ready() {
  return <output>ready</output>;
}
