import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const publishablePackages = [
  'packages/applik8s',
  'packages/core',
  'packages/sdk',
  'packages/compiler',
  'packages/runtime-contract',
  'packages/runtime',
  'packages/testing',
  'packages/typekro-adapter',
  'packages/typetainer',
];

const failures = [];

for (const packageDir of publishablePackages) {
  const manifestPath = `${packageDir}/package.json`;
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const { stdout } = await execFileAsync('npm', ['pack', '--dry-run', '--json', '.'], { cwd: packageDir, maxBuffer: 10 * 1024 * 1024 });
  const [packResult] = JSON.parse(stdout);
  const files = new Set((packResult?.files ?? []).map((file) => file.path));

  requirePackedFile(manifest.name, files, 'package.json');
  requireSomePackedFile(manifest.name, files, 'src/');

  for (const target of exportTargets(manifest.exports)) {
    requirePackedFile(manifest.name, files, stripDotSlash(target));
  }

  for (const target of Object.values(manifest.bin ?? {})) {
    requirePackedFile(manifest.name, files, stripDotSlash(target));
  }

  console.log(`${manifest.name}: ${packResult.filename} (${packResult.files.length} files, ${packResult.unpackedSize} bytes unpacked)`);
}

if (failures.length > 0) {
  console.error('Package publish dry-run failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

function requirePackedFile(packageName, files, path) {
  if (!files.has(path)) {
    failures.push(`${packageName}: npm pack output is missing ${path}`);
  }
}

function requireSomePackedFile(packageName, files, prefix) {
  for (const file of files) {
    if (file.startsWith(prefix)) {
      return;
    }
  }
  failures.push(`${packageName}: npm pack output is missing files under ${prefix}`);
}

function exportTargets(exports) {
  if (!exports) {
    return [];
  }
  if (typeof exports === 'string') {
    return [exports];
  }
  if (typeof exports !== 'object' || Array.isArray(exports)) {
    return [];
  }
  return Object.values(exports).flatMap((value) => {
    if (typeof value === 'string') {
      return [value];
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return exportTargets(value);
    }
    return [];
  });
}

function stripDotSlash(path) {
  return path.startsWith('./') ? path.slice(2) : path;
}
