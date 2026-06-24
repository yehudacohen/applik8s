# Contributing

`applik8s` is correctness-first. Contributions should preserve Kubernetes semantics rather than hiding them.

## Local Setup

Install dependencies:

```sh
bun install
```

Run core checks:

```sh
bun run check:local
```

Run character tests:

```sh
bun run test:character
```

Run opt-in Kubernetes E2E only against a pinned context:

```sh
APPLIK8S_E2E=1 APPLIK8S_E2E_CONTEXT=orbstack bun run test:e2e
```

## Test Taxonomy

- Unit and vertical tests prove implemented behavior.
- Character tests describe user-recognizable product promises.
- E2E tests prove generated artifacts against a real Kubernetes API server.
- Rust host and bridge tests prove runtime, ABI, validation, invocation, observability, and compatibility contracts.

Do not add broad public behavior without docs, tests, and compatibility notes.

See `docs/maintainer-policy.md` for the public API acceptance checklist.

## Public API Rule

Public APIs must either work, fail closed with explicit documented semantics, or stay out of the public surface.

Throwing placeholders are not acceptable public contracts for v0.1 unless the throw itself is the documented fail-closed behavior for an unsupported input.

## Roadmap Discipline

Use `BACKLOG.md` milestone tags:

- `[v0.1-required]`
- `[v0.1-wow]`
- `[v0.1-safety]`
- `[post-v0.1]`
- `[later]`

Update the roadmap when work lands so it does not drift from implementation reality.
