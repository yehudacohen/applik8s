# RFP: ApplicationPlan and Deployment-State Migration

**Status:** Accepted; architecture frozen; release-blocking for v0.9

**Revised:** 2026-08-30

**Target:** Applik8s v0.9 active-state migration from the released v0.8 baseline

**Depends on:** The exact released v0.8 package/artifact/plan schemas, Profiles and Concrete Provider
Bindings, recursive implementation identity, Alchemy state, TypeKro lifecycle state, the Effect Receipts,
Fencing, and Unknown Outcomes RFP, and versioned public-contract inventory schema conventions

**Coordinates with:** The Public Contract and Compatibility Freeze RFP, which inventories the resulting
migration artifacts and compatibility promises but does not own migration execution

**Unblocks:** Removal of target/installation authority without orphaning, duplicating, or silently adopting
live infrastructure

## Executive summary

v0.9 replaces target- and installation-shaped implementation selection with profiles, typed provider
bindings, and recursively composed implementation values. Source migration is not sufficient. Existing
deployments may contain persisted `ApplicationPlan` documents, Alchemy resources, TypeKro definitions and
instances, generated artifacts, shared owners, retained data, external bindings, and incomplete lifecycle
operations.

This RFP defines a restart-safe migration protocol. It preserves semantic and physical identities where
the new implementation is compatible, transfers lifecycle authority explicitly, refuses ambiguous
adoption, and records enough state to resume or roll back every pre-commit interruption.

## Normative decisions

1. Migration starts only from an exact released v0.8 baseline named by version, artifact schema, plan
   schema, provider catalog digest, and evidence manifest.
2. Reading an old plan is not migration. Active state is migrated only through a versioned migration run
   with durable receipts.
3. Source profile selection cannot silently change physical provider identity or lifecycle ownership.
4. Every legacy node maps to exactly one v0.9 semantic requirement, implementation node, external binding,
   retained node, or explicit retirement action.
5. Physical identity preservation is proven from canonical provider identity and provider-native resource
   identity, never inferred from display names alone.
6. Lifecycle ownership transfer is a fenced compare-and-set protocol. At most one mutation/deletion
   authority is active at any instant. A bounded, explicitly recorded quiescent interval with no active
   writer is permitted; two active writers are never permitted.
7. Shared singleton, externally owned, and retained-data resources are never adopted as application-owned
   merely because a new profile references them.
8. Ambiguous identity, incompatible guarantees, missing state, or unsupported provider migration fails
   before mutation.
9. Migration is resumable after every persisted phase and idempotent when replayed.
10. Rollback is supported only before the commit frontier unless a provider supplies a qualified reverse
    migration. After commit, recovery moves forward.
11. Imperative deployment, Alchemy, and documented GitOps upgrades use the same migration contract.
12. Deletion during migration follows the last durably recorded lifecycle authority and cannot bypass
    dependent-first teardown.

## Versioned inputs

```ts
interface ApplicationDeploymentMigrationSource {
  release: string;
  applicationArtifactDigest: string;
  applicationPlanSchema: string;
  providerCatalogDigest: string;
  deploymentStateIdentity: string;
  evidenceManifestDigest: string;
}

interface ApplicationDeploymentMigrationTarget {
  release: string;
  profile: string;
  applicationArtifactDigest: string;
  applicationPlanSchema: string;
  providerCatalogDigest: string;
}
```

The migrator rejects an unrecognized source schema or a source whose recorded digests do not match the
loaded migration codec. It does not guess from current application source.

The checked-in qualification fixture must not say merely `v0.8`, `v0.8.x`, `latest`, or a branch name. It
records the exact coordinated npm package versions, operator/host OCI digests, Git release tag and commit,
application-artifact schema, `ApplicationPlan` schema, provider-catalog digest, TypeKro/Alchemy versions,
and evidence-manifest digest. If v0.8 receives a later patch before v0.9 ships, each supported starting
release receives its own explicit source record and codec/evidence disposition.

## Identity mapping

Every source node produces one mapping record:

```ts
interface DeploymentNodeMigrationMapping {
  sourceNode: VersionedDeploymentNodeReference;
  targetSemanticRequirement?: ApplicationGraphNodeReference;
  targetImplementation?: CapabilityImplementationIdentity;
  sourcePhysicalIdentity?: CanonicalPhysicalIdentity;
  targetPhysicalIdentity?: CanonicalPhysicalIdentity;
  disposition:
    | "preserve"
    | "adopt"
    | "replace"
    | "retire"
    | "retain"
    | "external";
  lifecycleTransfer: LifecycleAuthorityTransfer;
  compatibility: readonly CompatibilityReceiptReference[];
  provenance: readonly SourceProvenanceReference[];
}
```

Canonical physical identity uses the provider's actual identity domain. Kubernetes identity is API group,
kind, namespace, and name, independent of served API version. AWS and other Alchemy resources use the
provider resource identity and account/region/project scope. External endpoints use a redacted stable
binding identity, not credential values.

An unchanged physical identity is not sufficient for adoption: provider contract, lifecycle owner,
retention, authority, and state schema must also be compatible.

## Lifecycle authority transfer

The migration protocol distinguishes:

- application/deployment-owned resources;
- shared singleton owners and consumer references;
- externally owned resources;
- retained data;
- ephemeral execution artifacts;
- resources already terminating or replacing.

For a preserved resource, the migrator writes the target state entry with a pending authority lease,
verifies the live identity and source state version, fences the source owner, activates the target authority
under the next epoch, then retires the legacy state entry. A pending target state entry is observational
only and cannot mutate or delete. A conflict rereads live provider state, the source state, target state,
and the canonical handoff record before retrying.

Every transfer has one durable handoff record:

```ts
interface LifecycleAuthorityHandoff {
  deployment: string;
  physicalIdentity: CanonicalPhysicalIdentity;
  revision: number;
  epoch: number;
  active:
    | { kind: "source"; authority: LifecycleAuthorityReference }
    | { kind: "migration"; authority: MigrationRunReference }
    | { kind: "target"; authority: LifecycleAuthorityReference }
    | { kind: "none"; reason: "quiescent-cutover" };
  sourceFence?: LifecycleFenceReceipt;
  targetActivation?: LifecycleActivationReceipt;
}
```

The source deployment checks the handoff epoch before every mutation or deletion. Transfer first prevents
new source work, drains or rejects admitted source work according to the resource contract, and persists a
source-fence receipt. Only then may the migration coordinator or target become active. Target activation is
a compare-and-set from the recorded fenced epoch and is valid only after rereading the canonical physical
identity. State engines that cannot honor this protocol require an explicit offline/quiesce procedure; the
migrator does not approximate atomic authority transfer across independent stores.

Replacement may temporarily assign the migration run exclusive authority to create the replacement,
transfer data, and remove the predecessor. The target runtime remains fenced until readiness and identity
preconditions pass. A quiescent `none` interval is safe and visible; it is never represented as successful
target activation.

For replacement, the provider declares create-before-delete or delete-before-create semantics, identity
preconditions, readiness frontier, data-transfer requirements, and rollback availability. The planner
must explain downtime and destructive consequences before mutation.

## Migration state machine

```text
proposed
  -> sourceVerified
  -> mapped
  -> targetPrepared
  -> authorityPending
  -> sourceFenced

sourceFenced
  -> migrationExclusive -> targetAuthorized
  -> targetAuthorized  (preserved-resource direct handoff)

targetAuthorized
  -> targetReady
  -> committed
  -> legacyRetired
  -> completed

Any pre-commit phase
  -> rollbackRequested
  -> rolledBack | rollbackBlocked

Any phase
  -> blocked | failedUnknown
```

Every transition is compare-and-set against migration run identity, handoff epoch, and revision. Receipts
record the source/target digests, node mappings, source fence, target activation, provider operations, live
observations, and next legal actions. Secret values are never recorded.

`committed` is the irreversible frontier at which the target plan and lifecycle owners become canonical.
Legacy state cannot resume mutation after this point. Cleanup failure after commit is forward-recoverable,
not grounds for reactivating legacy authority.

## Interruption and concurrency

Required crash tests cover:

- before and after source verification;
- after mapping but before any provider mutation;
- after target state preparation;
- between pending-authority and authority commit;
- after source fencing but before migration/target activation;
- during an explicitly quiescent zero-writer interval;
- after target activation but before the target's first mutation;
- after provider creation but before readiness receipt;
- after readiness but before commit;
- after commit but before legacy-state retirement;
- during shared-owner reference transfer;
- during retained-data detachment;
- during replacement deletion;
- after rollback fences the target but before source reactivation;
- concurrent deploy, migration, rollback, and delete requests.

Only one migration lease may advance one deployment identity. A stale migrator may observe but cannot
commit state. Provider operations use UID/version/resource-version preconditions where available.

## Rollback and forward recovery

Pre-commit rollback removes only target resources created by the migration, releases pending authority,
and proves the source deployment can resume. It never deletes preserved, external, shared, or retained
resources.

If the source was already fenced, rollback does not merely clear that fence. It first quiesces and fences
whichever migration or target authority is active, waits for its bounded drain receipt, verifies the source
state version and live physical identity, then compare-and-sets the handoff record to a new epoch whose
active authority is the source. Old source, migration, and target workers remain stale under their previous
epochs. If either target fencing or source reactivation cannot be proven, rollback becomes
`rollbackBlocked` and the deployment remains safely quiescent for forward/operator recovery.

After commit, `rollback` means a separately planned reverse provider migration. If unsupported, the CLI
returns an actionable forward-recovery plan rather than pretending the legacy release can safely resume.

## GitOps and imperative paths

`applik8s migrate` and deployment-time automatic migration both use this protocol. GitOps users receive a
versioned migration artifact and ordered procedure when an API server or controller cannot perform the
state transfer atomically. Applying only the new generated resources over legacy state is explicitly
unsupported when the migration plan contains authority transfer.

## Plan and explain

`applik8s plan` reports:

- exact source baseline and target profile;
- every semantic, implementation, and physical identity mapping;
- preserve/adopt/replace/retire/retain/external disposition;
- lifecycle-authority transfer;
- readiness and commit frontiers;
- destructive and downtime consequences;
- rollback boundary;
- provider and package prerequisites;
- rejected mappings and remediation.

## Diagnostics

```text
MIGRATION_SOURCE_RELEASE_UNQUALIFIED
MIGRATION_SOURCE_SCHEMA_UNSUPPORTED
MIGRATION_SOURCE_STATE_MISSING
MIGRATION_MAPPING_AMBIGUOUS
MIGRATION_PHYSICAL_IDENTITY_CONFLICT
MIGRATION_PROVIDER_INCOMPATIBLE
MIGRATION_LIFECYCLE_TRANSFER_UNSAFE
MIGRATION_RETAINED_DATA_UNSAFE
MIGRATION_SHARED_OWNER_BLOCKED
MIGRATION_CONCURRENT_OPERATION
MIGRATION_ROLLBACK_UNAVAILABLE
MIGRATION_FORWARD_RECOVERY_REQUIRED
MIGRATION_GITOPS_PROCEDURE_REQUIRED
```

## Implementation sequence

The alpha.1 foundation implements steps 2 and 3 as a pure
`ApplicationDeploymentMigrationProposal` mapper. Its output is permanently
`mode: "read-only"` and `mutationAuthorized: false`; it does not read or write
Alchemy, TypeKro, Kubernetes, GitOps, or provider state. The exact released
v0.8 fixture required by step 1 is not currently available, so executable
authority transfer and every deployment-state write remain gated off.

1. Freeze and publish the exact v0.8 source fixtures, state snapshots, codecs, and live evidence.
2. Define stable recursive implementation identity and the v0.9 plan schema.
3. Build the read-only mapper and ambiguity diagnostics.
4. Implement migration state and lifecycle-authority transfer without provider mutation.
5. Add TypeKro/Kubernetes and Alchemy provider migration adapters through the shared effect
   receipt/fencing/unknown-outcome contract.
6. Qualify preserve, replace, external, shared, retained, rollback, interruption, and deletion paths.
7. Integrate deployment CLI, `plan`, `explain`, and GitOps procedures.
8. Run live upgrades from the released v0.8 line before any dependent v0.9 provider is called stable.

## Acceptance

- Every released v0.8 plan and state fixture maps deterministically or fails before mutation.
- A live application upgrades without changing preserved resource UIDs or physical identities.
- Shared, external, and retained resources preserve their lifecycle contract.
- Interrupted migration resumes from every persisted phase.
- Pre-commit rollback restores one source authority and removes only target-created resources.
- Post-commit interruption completes through forward recovery.
- Concurrent deploy/delete/migrate requests cannot create dual owners or orphan state; interruption during
  a quiescent zero-writer handoff resumes from the recorded epoch.
- Imperative, Alchemy, and GitOps procedures converge to the same target plan.
- Deleting after migration uses dependent-first target lifecycle and leaves no legacy mutation authority.

## Non-goals

- arbitrary migration from every historic prerelease;
- automatic cross-provider data migration without a qualified provider adapter;
- rollback after an irreversible provider effect;
- inferring identity from names when provenance is unavailable;
- preserving target/installation as new public selection concepts.

## Definition of done

The migration contract is complete when the exact released v0.8 baseline can upgrade, interrupt, resume,
roll back before commit, recover after commit, and delete safely under the v0.9 profile/provider model with
at most one active lifecycle authority, an explicit bounded quiescent state, and complete source-attributed
evidence.
