import { describe, it, expect, onTestFinished } from 'vitest'
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  boot,
  initProfile,
  readProfilePatches,
  type ProfileContext,
} from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import NativeSettings from '@deepseek-ai/dsh-settings'
import { Config, type Config as LiveConfig } from '../src/host/config.js'
import { resolveConfig } from '../src/core/config.js'
import { SettingsBridge } from '../src/host/settings.js'
async function mount() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-recap-settings-'))),
    dir = join(home, 'profiles', 'isolated')
  initProfile(dir, ['recap-test-bundle'])
  const bundle = join(dir, 'node_modules', 'recap-test-bundle')
  mkdirSync(bundle, { recursive: true })
  writeFileSync(join(home, 'package.json'), '{"name":"recap-isolated-tests"}')
  writeFileSync(
    join(bundle, 'package.json'),
    JSON.stringify({
      name: 'recap-test-bundle',
      version: '1.0.0',
      dsh: { bundle: { patch: 'cordis.patch.yml' } },
    }),
  )
  writeFileSync(
    join(bundle, 'cordis.patch.yml'),
    JSON.stringify([
      {
        insert: [
          { id: 'editor', name: 'cordis:recap-editor' },
          { id: 'settings', name: 'cordis:recap-settings' },
          { id: 'renamed-recap', name: 'cordis:recap-probe', config: {} },
        ],
      },
    ]),
  )
  writeFileSync(join(dir, 'cordis.yml'), '[]\n')
  const profile: ProfileContext = {
    name: 'isolated',
    startedBundles: ['recap-test-bundle'],
    dir,
    patchPath: join(dir, 'cordis.patch.yml'),
    installAnchor: join(home, 'package.json'),
    cwd: home,
    home,
    overlays: [],
    telemetryDisabledEnv: undefined,
  }
  let bridge!: SettingsBridge,
    mounts = 0
  const probe = {
    Config,
    apply: (ctx: Context, reference: LiveConfig) => {
      mounts++
      bridge = new SettingsBridge(ctx, () => resolveConfig(reference.get()))
    },
  }
  let ctx: Context | undefined
  onTestFinished(async () => {
    try {
      await ctx?.fiber.dispose()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
  ctx = await boot('dsh', join(dir, 'cordis.yml'), readProfilePatches('dsh', profile), (root) => {
    root.provide('profileContext', profile)
    root.provide('appReady', {
      onReady: (listener: () => void) => {
        listener()
        return () => {}
      },
    })
    Object.assign(root.loader.builtins, {
      'recap-editor': ConfigEditor,
      'recap-settings': NativeSettings,
      'recap-probe': probe,
    })
  })
  return { bridge, profile, mounts: () => mounts }
}
describe('real Harness configuration integration (isolated profile)', () => {
  it('finds a renamed entry and applies a durable live edit without remounting', async () => {
    const f = await mount(),
      before = f.bridge.read()
    expect(before.writable).toBe(true)
    expect(before.namespace).toBe('renamed-recap')
    expect(f.mounts()).toBe(1)
    const after = await f.bridge.save({ idleMinutes: 7, language: 'en' }, before.revision!)
    expect(after.config.idleMinutes).toBe(7)
    expect(after.config.language).toBe('en')
    expect(after.revision).not.toBe(before.revision)
    expect(f.mounts()).toBe(1)
    expect(readFileSync(f.profile.patchPath, 'utf8')).toContain('idleMinutes: 7')
  })
  it('rejects a stale revision and leaves the newer value intact', async () => {
    const f = await mount(),
      before = f.bridge.read()
    await f.bridge.save({ idleMinutes: 17 }, before.revision!)
    await expect(f.bridge.save({ idleMinutes: 99 }, before.revision!)).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    })
    expect(f.bridge.read().config.idleMinutes).toBe(17)
  })
  it('allows only one of two concurrent writes with the same revision', async () => {
    const f = await mount(),
      revision = f.bridge.read().revision!
    const results = await Promise.allSettled([
      f.bridge.save({ minTurns: 4 }, revision),
      f.bridge.save({ minTurns: 5 }, revision),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
  })
  it('rejects invalid paired routes before any persistence', async () => {
    const f = await mount(),
      before = f.bridge.read()
    await expect(f.bridge.save({ provider: 'route-only' }, before.revision!)).rejects.toMatchObject(
      { code: 'INVALID_CONFIG' },
    )
    expect(f.bridge.read().revision).toBe(before.revision)
    expect(f.bridge.read().config.provider).toBe('')
  })
})
