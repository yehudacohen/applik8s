# Agentic Start source ownership

**Status:** normative for the v0.7 generated product

Agentic Start does not minimize generated source for its own sake. It keeps the
code a product builder is expected to understand and change, and packages the
mechanism that would otherwise be copied unchanged into unrelated products.

The decision test is:

1. Does the code express this product's nouns, policy, brand, journey, or
   provider choice? It belongs in generated application source.
2. Does the code implement a provider-neutral protocol, persistence adapter,
   generic query, lifecycle state machine, or infrastructure/runtime contract?
   It belongs in a maintained package.
3. Would moving it hide an important product decision behind a magical default?
   It stays generated even when a package could technically contain it.

## Ownership matrix

| Surface | Generated application owns | Maintained packages own |
| --- | --- | --- |
| Documents | document domain, review/publication policy, screens | canonical document tables and generic queries |
| Conversations | assistant journey, prompts, tool catalog, conversation screens | TanStack persistence adapter, AG-UI transport, canonical transcript/run storage, authority |
| Inbox and reviews | product decision types, reviewer policy, inbox UX | durable signals, approval receipts, workflow execution |
| Agents | profile contributions, instructions, tools, builder journey | version/query contracts and deterministic execution/evaluation mechanisms |
| Knowledge | source types, ingestion policy, grounding UX | canonical source/chunk models and generic queries |
| Evaluations | datasets, scorers, release criteria, comparison UX | evaluation records, query helpers, deterministic runtime checks |
| Integrations | offered connections, requested scopes, operator/member UX | provider-neutral connection intent and operational health reduction |
| Billing | plans, prices, entitlements, authorization, route composition, screens | provider capability, Stripe adapter, canonical billing models, wire contracts |
| Library/artifacts | Library terminology, provenance presentation, routes | artifact metadata, scoped artifact queries, transfer-safe naming/object intents |
| Data lifecycle | application targets, blockers, consequences, retention policy | lifecycle request model and generic progress vocabulary |
| Shell | information architecture, brand, role navigation, product layout | shadcn/Radix/TanStack dependencies only; no universal shell abstraction |

## Conversation compatibility boundary

`@tanstack/ai-persistence` is the authoritative chat transcript and protocol-run
lifecycle. `@applik8s/conversations` adapts the canonical, principal-scoped
Applik8s store to TanStack's `MessageStore` and `RunStore`. The gateway admits
both streaming POSTs and read-only hydration GETs, signs the exact agent/thread
binding, and never treats a browser-supplied thread ID as ownership proof.

Generated conversation UI uses `persistence: true`. It must not reconstruct a
second transcript from application queries or reconcile that copy with
`useChat.setMessages()`.

## Guardrail

`scripts/check-agentic-start-source-budget.mjs` checks both size and semantic
ownership. It rejects restored local billing contracts, lifecycle schemas,
manual transcript reconstruction, or artifact queries that bypass maintained
modules. A generated file may exceed a size target only when the exception names
the application-specific policy or experience that requires it.
