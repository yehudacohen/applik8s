# Clean npm First Run

This path starts outside the applik8s repository and uses only the published package.

```sh
mkdir hello-applik8s
cd hello-applik8s
npm init -y
npm pkg set type=module
npm install @applik8s/applik8s
npm install --save-dev @applik8s/cli
mkdir src
```

Create `src/operator.ts`:

```ts
import { sdk } from '@applik8s/applik8s/operator';
import { type } from '@applik8s/applik8s/dsl';

const Work = sdk.crd({
  apiVersion: 'hello.applik8s.dev/v1alpha1',
  kind: 'Work',
  plural: 'works',
  spec: type({ message: 'string' }),
  status: type({ "phase?": "'Pending' | 'Ready' | 'Failed'" }),
});

const ready = Work.on.reconcile(async (work) => {
  work.status.phase = 'Ready';
});

export default sdk.operator({ name: 'hello-applik8s', resources: { Work }, handlers: [ready] });
```

Compile it with the package executable:

```sh
npx applik8s build src/operator.ts --out-dir dist/applik8s
find dist/applik8s -maxdepth 3 -type f | sort
```

The output includes the operator manifest, normalized runtime contract, JavaScript bundle and source map, WASM component, Kubernetes resources, and a generated Dockerfile whose default base is the released multi-architecture operator host. Inspect those artifacts before building or applying them. The compiler does not contact a cluster during this step.

For local framework development, use `bun run applik8s ...` in the repository. For a consumer project, install `@applik8s/cli` as a development dependency and use `npx applik8s` or `node_modules/.bin/applik8s`; `@applik8s/applik8s` is the authoring/runtime facade and intentionally owns no executable.
