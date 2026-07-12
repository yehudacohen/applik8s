# GuestBook Show HN launch guide

Working title: **Show HN: This website is rendered by a Kubernetes control loop**

Suggested opening:

> Sign the guestbook and the generated server creates a GuestBookEntry custom resource. An operator written with applik8s reconciles it, renders the latest bounded snapshot into GuestBook status, and the generated server serves it. The example is intentionally unusual so the controller model is visible; it is not a recommendation to use etcd as a high-write application database.

## Founder comment draft

I built applik8s to explore what Kubernetes development feels like when TypeScript describes the application, its custom resources, its control loops, and its generated runtime artifacts together.

On this page, a POST creates a bounded `GuestBookEntry` CR. A generated TypeScript operator running as a Kubernetes controller validates and reconciles that object, then a second reconcile renders up to 20 current entries into `GuestBook.status.renderedHtml`. The generated web server reads and serves that snapshot. Older entries use a bounded typed index backed by Valkey.

The provocative title does not mean `kube-apiserver` or etcd executes a template engine. The renderer is a custom controller extending the Kubernetes control-loop model. applik8s compiles handler closures to a JavaScript-in-WASM component, generates CRDs/RBAC/Deployments/Services and an `ApplicationGraph`, and delegates Kubernetes resource composition to TypeKro. TypeKro in turn can delegate non-Kubernetes infrastructure to Alchemy.

CRDs are useful here because the example is deliberately control-plane-shaped and inspectable. I would keep high-write events, large blobs, arbitrary user content, and conventional transactional application data in their appropriate database/object/event stores. applik8s is an SDK, not a portability standard, and this is pre-1.0 software. The feedback I most want is where the TypeScript/control-plane boundary feels elegant, surprising, or dishonest.

## Technical FAQ

**Why CRDs instead of PostgreSQL? Is this abusing etcd?**  This is a bounded demonstration of controller semantics. CRDs fit desired/observed state and operator-owned domain objects; high-volume application rows do not. The showcase caps request rate, read size, rendered status, and index page size. PostgreSQL remains the default model store for transactional data.

**What executes TypeScript? Is everything WASM?**  Reconcile closures are bundled into JavaScript-in-WASM components hosted by the Rust operator host. Generated HTTP servers and durable command processors are Node workloads. Kubernetes itself schedules and persists resources; its stock binaries do not execute the renderer.

**How are closures captured?**  The compiler parses function source with the TypeScript AST. Literals—including embedded HTML, CSS, regexes, and client JavaScript—do not become captures. Supported resource/import bindings are explicit. Other module-scope identifiers fail compilation with the handler and identifier named.

**Can I inspect or escape the abstraction?**  Yes. Compilation emits YAML, CRDs, inferred RBAC, application graph, TypeKro resources, JavaScript bundles, manifests, and WASM components. Raw TypeKro resources and explicit Kubernetes SDK calls remain available where declared permissions make the boundary honest.

**How is this different from Kubebuilder/Operator SDK/Metacontroller?**  Those are controller-building tools. applik8s adds a TypeScript application model, serializable closures, generated server/model/job runtimes, typed indexes, provider contracts, and one graph tying generated artifacts back to source intent.

**Crossplane, Pulumi, or CDK8s?**  Crossplane composes infrastructure APIs; Pulumi primarily runs an external desired-state engine; CDK8s synthesizes manifests. applik8s focuses on long-lived Kubernetes-native application behavior and event flow back into TypeScript. It uses TypeKro for resource graphs rather than replacing it.

**Why TypeKro?**  It gives applik8s typed Kubernetes factories, direct and KRO execution, dependency/readiness semantics, aspects, event streaming, and provider compositions without duplicating a Kubernetes resource engine.

**What happens after manual edits?**  Fields owned by generated controllers/providers reconcile according to server-side-apply ownership. Conflicts and drift surface as diagnostics; applik8s does not promise that arbitrary edits to owned fields survive.

**CRD upgrades and scale limits?**  Schema changes are validated against compatibility policy; conversions still require explicit webhook strategy. Kubernetes object/etcd limits apply. The demo renders 20 entries, reads 100 per reconcile, uses bounded pages, rejects bodies over 4 KiB, and should not be treated as a benchmark.

**Is applik8s the portability contract?**  No. applik8s is an SDK. Its application graph and runtime contracts make boundaries inspectable, but Kubernetes APIs, provider choices, and generated artifacts remain real dependencies.

## Launch checklist

- [ ] Domain resolves to the intended Ingress endpoint.
- [ ] `Certificate` is `Ready=True` and HTTPS validates from an external client.
- [ ] Mobile layout and keyboard navigation work.
- [ ] Anonymous submission creates a named CR and reaches Published/Rejected then Rendered.
- [ ] Sanitized inspect endpoint reveals no secrets, annotations, managed fields, or internal endpoints.
- [ ] 4 KiB body limit, mutation rate limit, link rejection, duplicate suppression, and length checks are exercised.
- [ ] Moderation/reset command and old-entry retention procedure are rehearsed.
- [ ] Structured server/operator logs and alerts are visible.
- [ ] Generated-source links use the deployed commit SHA.
- [ ] README commands work from a clean checkout.
- [ ] CRDs, inferred RBAC, Ingress, Certificate, DNS intent, `ApplicationGraph`, bundles, and WASM artifacts are downloadable or linked.
- [ ] Every launch claim matches the deployed revision; DNS propagation is not labeled ready merely because intent was accepted.
