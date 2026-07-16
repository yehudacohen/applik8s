import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/healthz')({
  component: Health,
});

function Health() {
  return <output>ok</output>;
}
