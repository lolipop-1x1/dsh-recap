import { fileURLToPath } from 'node:url'
process.chdir(fileURLToPath(new URL('..', import.meta.url)))
import { readFile, access } from 'node:fs/promises'
import assert from 'node:assert/strict'
const pkg = JSON.parse(await readFile('package.json', 'utf8'))
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'))
assert.equal(lock.version, pkg.version)
assert.equal(lock.packages[''].version, pkg.version)
for (const file of [
  'dist/host/index.js',
  'dist/client.js',
  'dist/types/host/index.d.ts',
  'cordis.patch.yml',
  'LICENSE',
  'README.md',
  'README.zh-CN.md',
  'locale/en.json',
  'locale/zh.json',
  'icon.svg',
  ...pkg.files,
])
  await access(file)
const client = await readFile('dist/client.js', 'utf8')
assert.match(client, /window\.__ModuleLoader__\.load/)
assert.doesNotMatch(client, /require\(["']@deepseek-ai\//)
assert.doesNotMatch(client, /react\.production\.min|react\.development\.js/)
assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
const host = await import('../dist/host/index.js')
assert.equal(typeof host.apply, 'function')
assert.ok(host.Config)
console.log('Package entry points, metadata, client externals and Host import OK.')
import { runInNewContext } from 'node:vm'
import React from 'react'
let registration
runInNewContext(
  client,
  {
    window: {
      __ModuleLoader__: {
        load: (value) => {
          registration = value
        },
      },
    },
  },
  { timeout: 1000 },
)
assert.equal(registration.id, pkg.name)
const clientPlugin = registration.factory((id) => {
  assert.equal(id, 'react')
  return React
})
assert.equal(typeof clientPlugin.apply, 'function')
assert.equal(Array.from(clientPlugin.inject).join(','), 'slots,locale,remote,remote.session')
console.log('Compiled Client ModuleLoader factory executes with host-supplied React.')
