INSERT INTO applik8s_billing_plans (
  id,
  name,
  description,
  interval,
  price_microunits,
  currency,
  capabilities,
  active
) VALUES
  (
    'research-free',
    'Research Free',
    'Credential-free local research with bounded deterministic inference.',
    'month',
    0,
    'usd',
    '["research","local-inference"]'::jsonb,
    true
  ),
  (
    'research-team',
    'Research Team',
    'Shared research, durable workflows, tools, and expanded usage limits.',
    'month',
    25000000,
    'usd',
    '["research","shared-workspaces","durable-workflows","tools"]'::jsonb,
    true
  )
ON CONFLICT (id) DO NOTHING;

-- The research showcase deliberately opts into one credential-free Starter
-- workspace. This is application-owned product bootstrap, not identity-provider
-- tenancy inference. The generator substitutes the concrete application name
-- into the deterministic principal before this migration is emitted.
INSERT INTO workspaces (
  id,
  slug,
  name,
  owner_principal_id
) VALUES (
  '00000000-0000-4000-8000-000000000001',
  'local',
  'Local workspace',
  'principal:applik8s-template-project:deterministic:local-developer'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO workspace_memberships (
  id,
  workspace_id,
  identity_id,
  role
) VALUES (
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000001',
  'principal:applik8s-template-project:deterministic:local-developer',
  'workspace-owner'
)
ON CONFLICT (workspace_id, identity_id) DO NOTHING;

INSERT INTO applik8s_entitlements (
  id,
  principal_scope,
  capability,
  "limit",
  period,
  constraints,
  authority_revision,
  valid_from
) VALUES (
  'starter-local-research-review',
  '00000000-0000-4000-8000-000000000001',
  'research-review',
  100,
  'month',
  '{"profile":"starter"}'::jsonb,
  'applik8s-template-project-authority-v1',
  '2020-01-01T00:00:00.000Z'
)
ON CONFLICT (
  principal_scope,
  capability,
  authority_revision
) DO NOTHING;

INSERT INTO applik8s_evaluation_datasets (
  id,
  name,
  revision,
  schema_digest
) VALUES (
  'research-review-v1',
  'Research review quality',
  'v1',
  'sha256:research-review-v1'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO applik8s_evaluation_scorers (
  id,
  name,
  revision,
  implementation_digest
) VALUES (
  'research-review-human-v1',
  'Human review decision',
  'v1',
  'sha256:research-review-human-v1'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO applik8s_evaluation_cases (
  id,
  dataset_id,
  input,
  expected,
  tags
) VALUES (
  'research-review-approval',
  'research-review-v1',
  '{"kind":"research-review"}'::jsonb,
  '{"approved":true}'::jsonb,
  '["human-review","starter"]'::jsonb
)
ON CONFLICT (id) DO NOTHING;
