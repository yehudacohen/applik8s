export const agenticProductEvidenceJourneys = Object.freeze({
  routeReliability: Object.freeze({
    evidenceId: 'route-reliability',
    test: 'renders every first-run route without an unexpected server or hydration failure',
  }),
  causalAgentDocument: Object.freeze({
    evidenceId: 'causal-agent-note',
    test: 'attributes an agent-created document to its human requester and reactively renders it',
  }),
  durableSpecialist: Object.freeze({
    evidenceId: 'durable-specialist',
    test: 'creates one server-authored research document through an admitted durable specialist and preserves its run provenance',
  }),
  historicalLakehouse: Object.freeze({
    evidenceId: 'historical-usage-browser',
    test: 'renders qualified historical usage or an explicit unavailable-provider boundary',
  }),
  starterBilling: Object.freeze({
    evidenceId: 'starter-billing',
    test: 'uses the provider-neutral Starter billing path without Stripe credentials',
  }),
  maintainedAccount: Object.freeze({
    evidenceId: 'maintained-account',
    test: 'renders maintained provider-neutral account security without generated provider plumbing',
  }),
  durableDecision: Object.freeze({
    evidenceId: 'durable-decision',
    test: 'repeatedly delivers and resolves durable workspace decisions across browser reload',
  }),
  agentWorkbench: Object.freeze({
    evidenceId: 'agent-workbench',
    test: 'executes the deterministic runtime gate before publishing an exact agent revision',
  }),
  boundedKnowledge: Object.freeze({
    evidenceId: 'bounded-knowledge',
    test: 'admits bounded knowledge into agent context',
  }),
  notificationDelivery: Object.freeze({
    evidenceId: 'application-notification-delivery',
    test: 'delivers an authenticated workspace invitation through the configured notification provider',
  }),
  productLifecycleTrust: Object.freeze({
    evidenceId: 'product-lifecycle-trust',
    test: 'persists the product journey, explains AI trust, and enforces bounded data lifecycle controls',
  }),
});
