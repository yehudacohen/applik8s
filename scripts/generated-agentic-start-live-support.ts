import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Deterministic stand-in for the official TanStack CLI scaffold.
 *
 * Generator contract tests separately execute and pin the official CLI. Live
 * release qualification avoids a network dependency while preserving the
 * exact files onto which the maintained Start templates are overlaid.
 */
export async function writeOfficialTanStackScaffold(
  directory: string,
  projectName: string,
): Promise<void> {
  await mkdir(join(directory, 'src/routes'), { recursive: true });
  await writeFile(
    join(directory, 'package.json'),
    `${JSON.stringify({
      name: projectName,
      type: 'module',
      scripts: { dev: 'vite --port 3000' },
      dependencies: {
        '@tanstack/react-start': '1.168.28',
        '@tanstack/react-router': '1.168.28',
        react: '^19.1.0',
        'react-dom': '^19.1.0',
      },
      devDependencies: {
        '@vitejs/plugin-react': '^5.0.4',
        vite: '^7.1.7',
      },
    }, null, 2)}\n`,
  );
  await writeFile(
    join(directory, 'src/routes/index.tsx'),
    'export const upstreamScaffold = true;\n',
  );
  await writeFile(
    join(directory, 'src/routes/__root.tsx'),
    `import { createRootRoute, Outlet } from '@tanstack/react-router';
export const Route = createRootRoute({ component: () => <Outlet /> });
`,
  );
  await writeFile(
    join(directory, 'src/router.tsx'),
    `import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';
export function getRouter() {
  return createRouter({ routeTree, scrollRestoration: true });
}
`,
  );
  await writeFile(
    join(directory, 'tsconfig.json'),
    `${JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        jsx: 'react-jsx',
        strict: true,
        skipLibCheck: true,
        noEmit: true,
      },
      include: [
        'src/**/*.ts',
        'src/**/*.tsx',
        'vite.config.ts',
        'drizzle.config.ts',
      ],
    }, null, 2)}\n`,
  );
}
