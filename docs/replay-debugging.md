# Replay Debugging

Replay artifacts are opt-in diagnostics for failed reconciles. They are designed to answer: which operator, which handler, which object, which operation, which bundle, and whether local deterministic replay is possible.

## Enable Replay Artifacts

Set runtime replay configuration in the operator definition:

```ts
runtime: {
  replayArtifacts: {
    enabled: true,
    directory: '/tmp/applik8s-replay',
    includePayloads: false,
  },
}
```

Metadata-only artifacts are safer and are the default. Full-payload artifacts can replay locally but may contain object payloads, status, operation details, and raw handler errors.

## Inspect

```sh
bun run replay:inspect -- path/to/replay-artifact.json
```

or with the thin CLI:

```sh
bun run applik8s replay inspect path/to/replay-artifact.json
```

The summary reports operator name, handler ID, event, reconcile ID, failure phase/reason, redaction policy, debug artifacts, and replay readiness.

## Verify Debug Artifacts

```sh
bun run replay:inspect -- path/to/replay-artifact.json --bundle-dir dist/applik8s
```

This verifies recorded digests for `javascript-bundle`, `javascript-source-map`, and `esbuild-metafile` against the local build output.

## Execute Full-Payload Replay

```sh
bun run replay:inspect -- path/to/replay-artifact.json --bundle-dir dist/applik8s --execute
```

Replay execution loads the generated JavaScript dispatcher and invokes the handler with the captured input. It does not call Kubernetes, apply operations, or replay external side effects.

## Source Maps

When the local Node runtime supports `node:module.setSourceMapsEnabled`, replay execution enables it and reports `execution.sourceMapRuntime.status`. Keep `bundle/handler.js.map` next to the generated bundle to map generated stack frames back to TypeScript source paths.

## Common Failures

- `Replay execution requires a full-payload artifact.`: metadata-only artifacts can diagnose and correlate, but cannot execute.
- `Generated JavaScript bundle is missing`: pass `--bundle-dir` for the matching `dist/applik8s` output.
- `digestMismatch`: the artifact does not match the local build output. Rebuild from the same source or inspect the correct bundle directory.
- `Deterministic replay produced a plan that differs`: the handler is not deterministic for the captured input, or local source does not match the deployed bundle.
