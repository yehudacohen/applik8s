import { spawn } from 'node:child_process';

const gates = [
  ['bun', ['run', 'typecheck']],
  ['bun', ['run', 'lint']],
  ['bun', ['run', 'test:implemented']],
  ['bun', ['run', 'test:character']],
  ['cargo', ['test', '--workspace']],
];

for (const [command, args] of gates) {
  const code = await run(command, args);
  if (code !== 0) {
    process.exitCode = code;
    break;
  }
}

function run(command, args) {
  console.log(`\n$ ${[command, ...args].join(' ')}`);
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit', env: process.env });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}
