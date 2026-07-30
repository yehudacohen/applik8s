# Chirp: the realistic Applik8s application

> **Current status:** executable flagship increment, not yet the completed launch application. The accepted
> architecture and remaining phase gates live in [the Chirp RFP](../../docs/rfp-scalable-chirp.md).

Chirp is a Twitter-shaped application authored as one official TanStack Start project and one inspectable
Applik8s graph. It deliberately exercises the framework under realistic domain breadth:

- fifteen native Drizzle models with one committed PostgreSQL migration and deterministic starter data;
- direct callable actions and model-native views for accounts, profiles, posts, conversations, discovery,
  follows, reactions, bookmarks, media metadata, notifications, moderation, and automation configuration;
- PostgreSQL-authoritative command results, revisions, history, transactional outboxes, and query invalidation;
- replayable JetStream publication/engagement streams, bounded non-HTTP processors, SSE invalidation, and
  idempotent ClickHouse analytical facts;
- durable Hatchet moderation work and a `ModerationPolicy` CRD with readable typed lifecycle handlers;
- provider-neutral identity, authorization, object storage, workflow, and analytical storage boundaries;
- a responsive multi-route TanStack UI using the same generated model facade as SSR and workers;
- a typed `ChirpInstallation` RGD whose owner lives in `chirp-control` and safely owns the separate `chirp`
  workload Namespace.

The browser home timeline is now an authorized, generation-scoped Valkey projection queried through the same
snapshot/SSE protocol as relational views. PostgreSQL remains the relationship, authorization, outbox, and
invalidation authority; bounded fan-out-on-read merges the viewer and followed-author partitions while blocks
and mutes are enforced from authoritative relational state. The projection supports tombstones, retention,
durable checkpoints, atomic generation publication, and fail-closed revision-bound cursors. Its durable
`RebuildHomeTimelines` workflow scans the canonical Post model under a committed PostgreSQL snapshot, stores
definition-bound checksummed segments in S3, catches up JetStream history, resumes from a validated manifest,
and retains the old generation for explicit rollback/retirement. Full celebrity fan-out policy, live
Valkey-loss/rebuild qualification, complete analytical rebuilds, media processing, production identity
qualification, and the full live launch gate remain subsequent milestones.

## Build evidence

Build the official TanStack artifacts and the complete TypeKro application:

```sh
bun run check:v06:chirp-build
```

The gate checks the browser budget, forbidden browser dependencies, domain/action contracts, a distinct
control/workload namespace lifecycle, generated gateways/processors/workflows/operator resources, and that no
invalid empty `ChirpInstallation` is fabricated. Apply the explicit example instance from
[`kubernetes/chirp.example.yaml`](kubernetes/chirp.example.yaml).
[`kubernetes/chirp.external.example.yaml`](kubernetes/chirp.external.example.yaml)
shows the credential-free coordinates for a fully external provider profile;
the named Secrets are provisioned out of band and never contain values in the
Application graph.

Record a hardware- and worktree-identified artifact baseline with:

```sh
bun run benchmark:v06:chirp-artifacts:record
```

The report covers web/compiler wall time, browser gzip, server output, RGD size, and all generated OCI build
contexts. It deliberately labels context bytes as uncompressed local build inputs rather than image-layer or
registry-transfer measurements. Runtime images omit external source maps by default; maps remain separate
compiler artifacts without embedded source content.

## Local provider profile

The starter profile uses one web replica and one replica for each internal
gateway so the complete stack fits on a single-node development cluster.
The optional Hatchet dashboard is omitted from this profile; workflow execution
and health contracts remain fully enabled. Starter, dedicated, and external
capacity, storage, exposure, provider, and lifecycle choices come exclusively
from the validated `ChirpInstallation.spec`; ordinary authoring has no ambient
provider or replica environment-variable switch.

The explicit `identity.mode: deterministic-local` test profile accepts
`x-chirp-user` and defaults to `demo-user`. Dedicated and external profiles
select either Ory (Kratos session admission plus Keto relation assistance) or
Zitadel (OIDC userinfo plus admitted project roles). Both require an HTTPS
issuer, a concrete session endpoint, and a versioned authorization policy;
mismatched, unavailable, non-JSON, inactive, or incomplete provider responses
fail closed. Provider payloads are normalized at the `IdentityProvider` and
`Authorization` boundary, so domain models, queries, gateways, and routes do
not import vendor APIs.

The ordinary local deployment command verifies the exact `orbstack` context, reuses the ready shared
Valkey and Rook/Harbor platform, reconciles the Harbor project/robots, creates the retained Rook bucket claim,
builds and pushes all authored images, stages the explicit installation, and applies it through TypeKro:

```sh
bun run --cwd examples/chirp-start deploy:local
```

The deployment graph owns every declared artifact and lifecycle edge. Alchemy
records the scoped transaction, while TypeKro owns Kubernetes reconciliation,
readiness, and deletion. `applik8s delete` resumes that same graph-backed
lifecycle; it does not use preparation receipts or ad-hoc `kubectl delete`.

An external profile selects OCI registry, PostgreSQL, S3-compatible storage,
ClickHouse, and Hatchet coordinates from typed provider references while using
the same models, `Avatars`, `Attachments`, workflows, queries, and routes. Rook,
Harbor, CNPG, and other concrete local vendors remain absent from domain and UI
modules. Production operation additionally requires qualified identity, DNS,
certificate issuer, backup/export, capacity, egress, secret, and recovery
policy.
