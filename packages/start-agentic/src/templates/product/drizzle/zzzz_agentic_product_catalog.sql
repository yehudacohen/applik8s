-- Application-owned product policy. The framework owns the provider-neutral
-- models and delivery machinery; the generated product owns its plans.
INSERT INTO applik8s_billing_plans (
  id,
  name,
  description,
  interval,
  price_microunits,
  currency,
  capabilities,
  sort_order,
  active
) VALUES
  (
    'agentic_free',
    'Free',
    'A credential-free local plan for evaluating the complete product.',
    'month',
    0,
    'usd',
    '["notes","assistant","local-inference"]'::jsonb,
    0,
    true
  ),
  (
    'agentic_team_monthly',
    'Team',
    'Shared agentic work with live providers and expanded usage.',
    'month',
    25000000,
    'usd',
    '["notes","assistant","live-inference","metered-usage"]'::jsonb,
    1,
    true
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO applik8s_billing_catalog_versions (
  id,
  plan_id,
  version,
  state,
  currency,
  recommended,
  published_at
) VALUES
  (
    'agentic_free_v1',
    'agentic_free',
    1,
    'published',
    'usd',
    true,
    now()
  ),
  (
    'agentic_team_monthly_v1',
    'agentic_team_monthly',
    1,
    'published',
    'usd',
    true,
    now()
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO applik8s_billing_catalog_prices (
  id,
  catalog_version_id,
  billing_model,
  interval,
  unit_amount_microunits,
  provider,
  lookup_key,
  active
) VALUES
  (
    'agentic_free_v1_local',
    'agentic_free_v1',
    'flat',
    'month',
    0,
    'local',
    'agentic_free',
    true
  ),
  (
    'agentic_team_monthly_v1_stripe',
    'agentic_team_monthly_v1',
    'flat',
    'month',
    25000000,
    'stripe',
    'agentic_team_monthly',
    true
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO applik8s_billing_catalog_entitlements (
  id,
  catalog_version_id,
  capability,
  enabled,
  quantity_limit,
  constraints
) VALUES
  (
    'agentic_free_notes',
    'agentic_free_v1',
    'notes',
    true,
    1000,
    '{}'::jsonb
  ),
  (
    'agentic_team_notes',
    'agentic_team_monthly_v1',
    'notes',
    true,
    null,
    '{}'::jsonb
  ),
  (
    'agentic_team_live_inference',
    'agentic_team_monthly_v1',
    'live-inference',
    true,
    null,
    '{}'::jsonb
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO applik8s_billing_meters (
  id,
  key,
  display_name,
  aggregation,
  event_name,
  provider,
  active
) VALUES
  (
    'agentic_tokens',
    'agentic_tokens',
    'Agentic tokens',
    'sum',
    'agentic_tokens',
    'portable',
    true
  )
ON CONFLICT (id) DO NOTHING;

-- Live Stripe profiles resolve non-price IDs as Stripe Price lookup keys.
-- Reconcile a Stripe Price with lookup_key=agentic_team_monthly before using
-- the generated Team plan against a live Stripe account.
