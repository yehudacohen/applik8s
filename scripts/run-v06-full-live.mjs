import { spawn } from 'node:child_process';
const root = process.cwd();
const context = process.env.APPLIK8S_E2E_CONTEXT ?? 'orbstack';
let chirpDeploymentStarted = false;

try {
  // The generated v0.6 application publishes through the retained Harbor
  // platform owned by Chirp, so the application graph must exist first.
  await runScript('deploy:v06:chirp-twice');
  chirpDeploymentStarted = true;

  await runScript('test:v06:live');
  await runScript('test:v06:chirp-live');
  await runScript('test:v06:chirp-browser');
  // Run datastore qualification after every source-generating application
  // lane. Evidence receipts bind to the complete working-tree candidate, so a
  // later generated route tree or migration would otherwise make an earlier
  // datastore receipt stale even though its live assertions passed.
  await runScript('test:v06:datastores-live');
  await run([
    'run',
    'scripts/check-v06-scorecard.ts',
    '--require-live',
    '--require-chirp',
  ]);
} finally {
  if (chirpDeploymentStarted) {
    await destroyChirp();
  }
}

async function runScript(name) {
  await run(['run', name]);
}

async function destroyChirp() {
  await run([
    'run',
    'packages/cli/src/bin.ts',
    'destroy',
    'examples/chirp-start/src/application.ts',
    '--context',
    context,
    '--out-dir',
    'examples/chirp-start/.applik8s/deploy',
    '--composition-name',
    'app',
    '--instance-name',
    process.env.APPLIK8S_CHIRP_INSTANCE ?? 'chirp',
    '--control-plane-namespace',
    process.env.APPLIK8S_CONTROL_PLANE_NAMESPACE ?? 'chirp-control',
  ]);
}

async function run(args) {
  await new Promise((resolve, reject) => {
    const child = spawn('bun', args, {
      cwd: root,
      env: {
        ...process.env,
        APPLIK8S_E2E_CONTEXT: context,
      },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `bun ${args.join(' ')} failed with ${
            signal ? `signal ${signal}` : `exit code ${String(code)}`
          }.`,
        ),
      );
    });
  });
}
