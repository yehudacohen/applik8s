# v0.7 TypeKro/Alchemy lifecycle evidence

This receipt records the first focused live qualification of the v0.7
`ApplicationDeploymentGraph` → TypeKro 0.33.5 → Alchemy beta.58 engine. It is
evidence for the engine seam, not a substitute for the final full GuestBook,
Chirp, identity, and provider acceptance run.

## 2026-08-02 OrbStack run

Command:

```sh
bun run test:v07:lifecycle:orbstack
```

Environment:

- Kubernetes context: `orbstack`
- TypeKro: `0.33.5`
- Alchemy: `2.0.0-beta.58`
- Effect: `4.0.0-beta.84`
- test file:
  `packages/e2e/test/deployment-alchemy-lifecycle.e2e.test.ts`

Result:

```text
Test Files  1 passed (1)
Tests       3 passed (3)
Duration    705.06s
direct      348.534s
kro         354.496s
ownership   0.853s
```

The direct path proved:

1. an application-owned Namespace is materialized first;
2. a deliberately invalid dependent Kubernetes resource fails after that
   prerequisite exists;
3. a corrected graph resumes against the same Alchemy Stack and adopts the
   prerequisite;
4. an unchanged plan contains only `noop`;
5. a changed graph updates the ConfigMap from `v1` to `v2`; and
6. `deployment.destroy()` removes the ConfigMap and Namespace, after which the
   observer waits for an actual Namespace 404.

The KRO path proved:

1. the same portable graph materializes a direct Namespace prerequisite plus
   one RGD and one instance;
2. an unchanged plan contains only `noop`;
3. a changed graph updates both RGD and instance and converges the child
   ConfigMap;
4. destruction removes the instance before its RGD, then removes the direct
   Namespace prerequisite; and
5. the observer sees both the RGD and Namespace become absent.

The ownership path additionally proved:

1. an ephemeral generated Secret is deleted with its graph;
2. a retained generated Secret survives graph destruction with its exact
   installation ownership metadata intact;
3. a fresh graph carrying the same ownership identity can deliberately adopt
   and delete that retained Secret without an out-of-band Kubernetes mutation;
4. a different installation cannot rewrite or delete the seed installation's
   same-node resource; and
5. the seed installation remains the sole deletion authority for its Secret.

No successful lifecycle step or cleanup path used `kubectl delete`. `kubectl`
was observation-only.

## OrbStack namespace-controller latency

Both modes removed their graph-owned content quickly, but OrbStack retained the
otherwise empty Namespace in `Terminating` with only Kubernetes' built-in
namespace finalizer for roughly five and a half minutes. This run observed
340,854 ms in direct mode and 345,897 ms in KRO mode. The test treats deletion
acceptance as non-terminal and waits for the real 404, making this latency
visible without inventing an Applik8s finalizer workaround.

## Remaining boundary

This historical receipt is not final-candidate evidence. Before the scorecard
item becomes complete, the exact release candidate must rerun this lane and
write the machine-checked `v07-lifecycle` receipt required by
`scripts/v07-release-evidence-contract.ts`. The integrated provider/application
matrix must additionally produce current GuestBook, Chirp, identity, and
profile receipts with the same git and cluster identity. Retained and external
ownership are proven in this focused lane, but the scorecard deliberately
remains partial until the exact-candidate receipt exists.
Multi-cluster qualification remains explicitly deferred.
