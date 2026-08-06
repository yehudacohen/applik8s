import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const manifestPath = resolve(root, 'docs/v07-stimp-parity.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const scorecard = JSON.parse(
  await readFile(resolve(root, 'docs/v0.7-scorecard.json'), 'utf8'),
);
const packageManifest = JSON.parse(
  await readFile(resolve(root, 'package.json'), 'utf8'),
);
const failures = [];

if (manifest.schemaVersion !== 3) failures.push('unsupported manifest schema');
if (
  manifest.baseline?.revision
  !== '602ec975f7c29c9e2faa7b767ec218745590c7cf'
) {
  failures.push('the reviewed Stimp revision changed');
}
if (scorecard.baseline?.revision !== manifest.baseline?.revision) {
  failures.push('the scorecard and parity manifest pin different Stimp revisions');
}
if (!Array.isArray(manifest.capabilities) || manifest.capabilities.length < 12) {
  failures.push('the parity manifest does not cover the required baseline product paths');
}

const capabilityMap = manifest.capabilityMap;
if (
  typeof capabilityMap?.document !== 'string'
  || capabilityMap.scope !== 'complete committed agent-saas-starter product surface'
  || !Array.isArray(capabilityMap.implementationColumns)
  || capabilityMap.implementationColumns.length !== 4
  || !Array.isArray(capabilityMap.requiredAreas)
  || capabilityMap.requiredAreas.length !== 8
  || capabilityMap.acceptanceJourneys !== 9
) {
  failures.push('the complete Agentic Start capability map contract is missing');
} else {
  try {
    const source = await readFile(resolve(root, capabilityMap.document), 'utf8');
    for (const column of capabilityMap.implementationColumns) {
      if (!source.includes(column)) {
        failures.push(
          `the Agentic Start capability map lacks implementation column ${column}`,
        );
      }
    }
    for (const area of capabilityMap.requiredAreas) {
      if (!source.includes(`### ${area}`)) {
        failures.push(
          `the Agentic Start capability map lacks required area ${area}`,
        );
      }
    }
    const journeys = [
      ...source.matchAll(/^\d+\. /gmu),
    ].length;
    if (journeys < capabilityMap.acceptanceJourneys) {
      failures.push(
        `the Agentic Start capability map defines only ${journeys} acceptance journeys`,
      );
    }
    const incompleteCapabilities = [
      ...source.matchAll(
        /^\| ([^|\n]+) \| [^|\n]+ \| [^|\n]+ \| [^|\n]+ \| (Partial|Missing) \|$/gmu,
      ),
    ].map((match) => `${match[1].trim()} (${match[2]})`);
    if (incompleteCapabilities.length > 0) {
      failures.push(
        `the Agentic Start capability map still has incomplete product behavior: ${
          incompleteCapabilities.join(', ')
        }`,
      );
    }
  } catch (error) {
    failures.push(
      `the Agentic Start capability map is unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

const ids = new Set();
const baselinePaths = new Set();
for (const capability of manifest.capabilities ?? []) {
  if (typeof capability.id !== 'string' || !capability.id.trim()) {
    failures.push('a capability has no stable id');
    continue;
  }
  if (ids.has(capability.id)) failures.push(`duplicate capability ${capability.id}`);
  ids.add(capability.id);
  if (!['preserved', 'improved', 'deferred', 'rejected'].includes(capability.disposition)) {
    failures.push(`${capability.id} has an invalid disposition`);
  }
  if (
    typeof capability.baselinePath !== 'string'
    || baselinePaths.has(capability.baselinePath)
  ) {
    failures.push(`${capability.id} has a missing or duplicate baseline path`);
  }
  baselinePaths.add(capability.baselinePath);
  if (!/^[0-9a-f]{40}$/.test(capability.baselineBlob ?? '')) {
    failures.push(`${capability.id} has no pinned baseline blob`);
  }
  const ledger = manifest.ledger?.[capability.id];
  if (
    typeof ledger?.rationale !== 'string'
    || !ledger.rationale.trim()
    || typeof ledger?.replacement !== 'string'
    || !ledger.replacement.trim()
  ) {
    failures.push(`${capability.id} has no reviewed disposition rationale and replacement`);
  }
  if (
    typeof capability.evidence !== 'string'
    || typeof capability.marker !== 'string'
  ) {
    failures.push(`${capability.id} has no implementation evidence contract`);
    continue;
  }
  try {
    const source = await readFile(resolve(root, capability.evidence), 'utf8');
    if (!source.includes(capability.marker)) {
      failures.push(
        `${capability.id} evidence ${capability.evidence} lacks ${JSON.stringify(capability.marker)}`,
      );
    }
  } catch (error) {
    failures.push(
      `${capability.id} evidence ${capability.evidence} is unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

const inventoryDigest = createHash('sha256')
  .update(
    (manifest.capabilities ?? [])
      .map(
        (capability) =>
          `${capability.baselinePath}\0${capability.baselineBlob}\n`,
      )
      .join(''),
  )
  .digest('hex');
if (manifest.baseline?.inventoryDigest !== `sha256:${inventoryDigest}`) {
  failures.push('the pinned baseline inventory digest does not match its paths and blobs');
}

const fixture = manifest.behaviorFixture;
if (
  typeof fixture?.test !== 'string'
  || !Array.isArray(fixture.contracts)
  || fixture.contracts.length < 7
) {
  failures.push('the generated behavioral parity fixture is incomplete');
} else {
  try {
    await access(resolve(root, fixture.test));
  } catch {
    failures.push(`the generated behavioral parity fixture ${fixture.test} is unavailable`);
  }
  const stimpScript = packageManifest.scripts?.['check:v07:stimp'];
  if (
    typeof stimpScript !== 'string'
    || !stimpScript.includes(fixture.test)
  ) {
    failures.push('check:v07:stimp does not execute the generated behavioral parity fixture');
  }
}

const acceptanceEvidence = manifest.acceptanceEvidence;
if (
  !Array.isArray(acceptanceEvidence)
  || acceptanceEvidence.length !== capabilityMap.acceptanceJourneys
) {
  failures.push(
    `the parity manifest must map exactly ${capabilityMap.acceptanceJourneys} executable acceptance journeys`,
  );
} else {
  const journeyIds = new Set();
  for (const journey of acceptanceEvidence) {
    if (
      typeof journey.id !== 'string'
      || !journey.id.trim()
      || journeyIds.has(journey.id)
    ) {
      failures.push('an acceptance journey has a missing or duplicate stable id');
      continue;
    }
    journeyIds.add(journey.id);
    if (!Array.isArray(journey.scripts) || journey.scripts.length === 0) {
      failures.push(`${journey.id} has no executable package script`);
    } else {
      for (const script of journey.scripts) {
        if (typeof packageManifest.scripts?.[script] !== 'string') {
          failures.push(`${journey.id} references missing package script ${script}`);
        }
      }
    }
    if (!Array.isArray(journey.evidence) || journey.evidence.length === 0) {
      failures.push(`${journey.id} has no executable evidence`);
      continue;
    }
    for (const evidence of journey.evidence) {
      if (
        typeof evidence?.path !== 'string'
        || typeof evidence?.marker !== 'string'
      ) {
        failures.push(`${journey.id} has malformed evidence`);
        continue;
      }
      try {
        const source = await readFile(resolve(root, evidence.path), 'utf8');
        if (!source.includes(evidence.marker)) {
          failures.push(
            `${journey.id} evidence ${evidence.path} lacks ${JSON.stringify(evidence.marker)}`,
          );
        }
      } catch (error) {
        failures.push(
          `${journey.id} evidence ${evidence.path} is unavailable: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
}

const configuredBaselineRepository =
  process.env.STIMP_BASELINE_REPOSITORY
  ?? manifest.baseline?.repository;
let verifiedGitObjects = false;
if (typeof configuredBaselineRepository === 'string') {
  try {
    await access(configuredBaselineRepository);
    verifiedGitObjects = true;
    for (const capability of manifest.capabilities ?? []) {
      try {
        const { stdout } = await execFileAsync(
          'git',
          [
            '-C',
            configuredBaselineRepository,
            'rev-parse',
            `${manifest.baseline.revision}:${capability.baselinePath}`,
          ],
          { maxBuffer: 1024 * 1024 },
        );
        if (stdout.trim() !== capability.baselineBlob) {
          failures.push(
            `${capability.id} baseline blob does not match the pinned Stimp revision`,
          );
        }
      } catch (error) {
        failures.push(
          `${capability.id} baseline object cannot be verified: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  } catch {
    if (process.env.STIMP_BASELINE_REPOSITORY) {
      failures.push(
        `STIMP_BASELINE_REPOSITORY ${configuredBaselineRepository} is unavailable`,
      );
    }
  }
}

if (failures.length > 0) {
  throw new Error(
    `v0.7 Stimp parity failed:\n${failures
      .map((failure) => `- ${failure}`)
      .join('\n')}`,
  );
}

console.log(
  `v0.7 Stimp parity passed for ${manifest.capabilities.length} pinned product paths; `
  + `${verifiedGitObjects ? 'all baseline Git objects verified' : 'inventory digest verified'}; `
  + `${capabilityMap.requiredAreas.length} product areas and `
  + `${acceptanceEvidence.length} acceptance journeys have executable gates; `
  + `${fixture.contracts.length} generated product contracts are currently executable.`,
);
