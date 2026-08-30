# Applik8s documentation site

This private workspace contains the versioned Applik8s documentation website.
It uses Astro and Starlight, emits static HTML, and builds a same-origin
Pagefind index.

```sh
bun run --cwd docs-site dev
bun run check:v09:docs
```

The v0.9 alpha content is served under `/docs/preview/v0.9/` and carries a
`noindex,nofollow` marker. A stable release snapshot must be built from the
matching release tag and contract inventory before `/docs/current/` can point
to it.

The Markdown RFPs in `../docs` remain design records. Pages under
`src/content/docs` are the ordinary product documentation and must not redefine
public contracts, maturity, or provider evidence.
