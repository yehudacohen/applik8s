import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const root = resolve(process.cwd());
const target = join(root, 'packages', 'deployment-alchemy', 'src');
const forbidden = [
  /aws-cloudformation/iu,
  /AWS::CloudFormation/iu,
  /aws\s+cloudformation/iu,
  /synthesizeApplicationAwsCloudFormation/iu,
  /ApplicationAwsTarget/iu,
  /AWS\.providers\s*\(/u,
];
const findings = [];
const extensionTypes = new Set();
for (const path of await files(target)) {
  const source = await readFile(path, 'utf8');
  for (const pattern of forbidden) {
    if (pattern.test(source)) findings.push(`${relative(root, path)} matches ${pattern}`);
  }
  if (/aws-native-(?:resources|compute-resources|stateful-resources)\.[cm]?[jt]s$/u.test(path)) {
    for (const match of source.matchAll(/['"](Applik8s\.AWS\.[A-Za-z0-9.]+)['"]/gu)) {
      extensionTypes.add(match[1]);
    }
  }
}
if (findings.length > 0) throw new Error(`AWS deployment must use native Alchemy resources:\n${findings.map((finding) => `- ${finding}`).join('\n')}`);
const allowedExtensions = new Set([
  'Applik8s.AWS.ElastiCache.SubnetGroup',
  'Applik8s.AWS.ElastiCache.ValkeyReplicationGroup',
  'Applik8s.AWS.ECS.OneShotTask',
]);
const unexpectedExtensions = [...extensionTypes].filter((type) => !allowedExtensions.has(type));
const missingExtensions = [...allowedExtensions].filter((type) => !extensionTypes.has(type));
if (unexpectedExtensions.length > 0 || missingExtensions.length > 0) {
  throw new Error([
    'AWS native extension boundary drifted from the three justified lifecycle resources.',
    ...(unexpectedExtensions.length > 0 ? [`Unexpected: ${unexpectedExtensions.sort().join(', ')}`] : []),
    ...(missingExtensions.length > 0 ? [`Missing: ${missingExtensions.sort().join(', ')}`] : []),
  ].join('\n'));
}
console.log('AWS deployment uses upstream Alchemy resources plus exactly three focused lifecycle extensions.');

async function files(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await files(path));
    else if (entry.isFile() && /\.[cm]?[jt]sx?$/u.test(entry.name)) output.push(path);
  }
  return output;
}
