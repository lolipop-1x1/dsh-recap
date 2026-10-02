import { fileURLToPath } from 'node:url'
process.chdir(fileURLToPath(new URL('..', import.meta.url)))
import { build } from 'esbuild'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
await rm('dist', { recursive: true, force: true })
await mkdir('dist', { recursive: true })
await build({
  entryPoints: ['src/host/index.ts'],
  outfile: 'dist/host/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  sourcemap: true,
})
const client = await build({
  entryPoints: ['src/client/index.tsx'],
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  target: 'es2022',
  external: ['react'],
  write: false,
  legalComments: 'none',
})
const body = client.outputFiles[0].text
await writeFile(
  'dist/client.js',
  `/* DSH Recap — MIT. React is supplied by Harness. */
window.__ModuleLoader__.load({id: 'dsh-recap', factory(require) {
const module = { exports: {} };
const exports = module.exports;
${body}
return module.exports;
}});
`,
)
const result = spawnSync(
  process.execPath,
  ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.host.json', '--emitDeclarationOnly'],
  { stdio: 'inherit' },
)
if (result.status !== 0) process.exit(result.status ?? 1)
console.log('Built Host, Client ModuleLoader bundle and declarations.')
