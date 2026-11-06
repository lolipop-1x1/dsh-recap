import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { evaluatePluginCompatibility } from '@deepseek-ai/dsh-app-boot'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

describe('Harness 版本声明', () => {
  it.each(['0.2.0-rc.2', '0.2.2-rc.1', '0.2.3-rc.1', '0.3.0', '1.0.0'])(
    '允许最低支持版本及更高版本 %s 通过宿主检查',
    (version) => {
      expect(evaluatePluginCompatibility(manifest, {}, version)).toBeUndefined()
      const peersOnly = { ...manifest }
      delete peersOnly.engines
      expect(evaluatePluginCompatibility(peersOnly, {}, version)).toBeUndefined()
    },
  )

  it.each(['0.1.9', '0.2.0-rc.1'])('拒绝低于最低支持版本的宿主 %s', (version) => {
    expect(evaluatePluginCompatibility(manifest, {}, version)).toBeDefined()
  })
})
