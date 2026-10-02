import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'

/** Exercise source plugin registration through the installed SDK's real slot renderer. */
export async function runSettingsSlotsRegression() {
  const fixture = await build({
    entryPoints: [fileURLToPath(new URL('../tests/settings-slots-fixture.tsx', import.meta.url))],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    define: { 'process.env.NODE_ENV': '"production"' },
    write: false,
  })
  const sdk = await readFile(
    fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-client-ui-renderer/client')),
    'utf8',
  )
  const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    executablePath =
      process.env.CHROME_PATH ||
      (process.platform === 'darwin' && existsSync(macChrome) ? macChrome : undefined)
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  })
  const checks = [],
    errors = []
  let page,
    disposed = false
  try {
    page = await browser.newPage()
    page.setDefaultTimeout(10000)
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>')
    await page.addScriptTag({ content: fixture.outputFiles[0].text })
    await page.addScriptTag({ content: sdk })
    await page.evaluate(() => window.startSettingsSlots())
    const input = page.locator('#dshr-setting-idleMinutes'),
      state = () => page.evaluate(() => window.settingsSlotsTest.snapshot())
    await input.waitFor({ state: 'visible' })
    assert.equal(await input.inputValue(), '3')
    assert.equal(await page.getByRole('navigation').innerText(), '会话回顾')
    await page.evaluate(() => window.settingsSlotsTest.captureInput())
    checks.push('Source plugin mounts through the real SDK ModuleLoader, SlotCore and Renderer')

    await input.fill('17')
    await page.evaluate(() => window.settingsSlotsTest.language('en'))
    await page.getByRole('heading', { name: 'Recap', exact: true }).waitFor()
    assert.equal(await page.getByRole('navigation').innerText(), 'Recap')
    assert.equal(await input.inputValue(), '17')
    assert.equal(
      await page.getByRole('button', { name: 'Save changes', exact: true }).isEnabled(),
      true,
    )
    const draft = await state()
    assert.equal(draft.reads, 1)
    assert.equal(draft.sameEntry, true)
    assert.equal(draft.sameInput, true)
    checks.push('Changing locale updates menu copy without replacing the entry or losing the draft')

    await page.evaluate(() => window.settingsSlotsTest.holdNextSave())
    await page.getByRole('button', { name: 'Save changes', exact: true }).click()
    await page.getByRole('button', { name: 'Saving…', exact: true }).waitFor()
    await page.waitForFunction(() => window.settingsSlotsTest.snapshot().pending)
    await page.evaluate(() => window.settingsSlotsTest.language('zh-CN'))
    await page.getByRole('heading', { name: '会话回顾', exact: true }).waitFor()
    assert.equal(await page.getByRole('navigation').innerText(), '会话回顾')
    assert.equal(await input.inputValue(), '17')
    assert.equal(await input.isDisabled(), true)
    assert.equal(
      await page.getByRole('button', { name: '保存中…', exact: true }).isDisabled(),
      true,
    )
    const saving = await state()
    assert.equal(saving.sameEntry, true)
    assert.equal(saving.sameInput, true)
    assert.equal(saving.reads, 1)
    assert.equal(saving.aborted, 0)
    assert.equal(saving.pending, true)
    assert.deepEqual(saving.lastPatch, { idleMinutes: 17 })
    checks.push(
      'Locale changes preserve the in-flight save, draft, disabled fields and entry identity',
    )

    await page.evaluate(() => window.settingsSlotsTest.finishSave())
    await page.getByText('已保存，即时生效', { exact: true }).waitFor()
    assert.equal(await input.inputValue(), '17')
    assert.equal(
      await page.getByRole('button', { name: '保存设置', exact: true }).isDisabled(),
      true,
    )
    const saved = await state()
    assert.equal(saved.value, 17)
    assert.equal(saved.saves, 1)
    assert.equal(saved.aborted, 0)
    assert.equal(saved.sameInput, true)
    checks.push('The same save completes once and displays confirmation in the new locale')

    await input.fill('19')
    await page.evaluate(() => window.settingsSlotsTest.holdNextSave())
    await page.getByRole('button', { name: '保存设置', exact: true }).click()
    await page.waitForFunction(() => window.settingsSlotsTest.snapshot().pending)
    await page.evaluate(() => window.settingsSlotsTest.unloadPlugin())
    await page.locator('.dshr-settings').waitFor({ state: 'detached' })
    await page.waitForFunction(() => window.settingsSlotsTest.snapshot().aborted === 1)
    const unloaded = await state()
    assert.equal(unloaded.entries, 0)
    assert.equal(unloaded.styles, 0)
    assert.equal(unloaded.pending, false)
    assert.equal(unloaded.value, 17)
    assert.equal(unloaded.localeListeners, 1) // Only the fixture's menu remains subscribed.
    await page.evaluate(() => window.settingsSlotsTest.language('en'))
    const afterLocale = await state()
    assert.equal(afterLocale.entries, 0)
    assert.equal(afterLocale.styles, 0)
    assert.equal(afterLocale.reads, 1)
    assert.equal(afterLocale.saves, 2)
    checks.push(
      'Plugin unload removes slots, styles and the Settings locale subscription, and aborts a pending save',
    )

    await page.evaluate(() => window.settingsSlotsTest.dispose())
    disposed = true
    assert.equal((await state()).localeListeners, 0)
    assert.equal(await page.locator('#root').innerHTML(), '')
    assert.deepEqual(errors, [])
    checks.push(
      'Renderer/context cleanup leaves no locale subscriptions or uncaught browser errors',
    )
    console.log(`Settings slot browser checks passed: ${checks.length} (${browser.version()})`)
    for (const check of checks) console.log(`  ✓ ${check}`)
    return { checks, errors }
  } finally {
    if (page && !disposed)
      await page.evaluate(() => window.settingsSlotsTest?.dispose()).catch(() => undefined)
    await browser.close()
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]))
  await runSettingsSlotsRegression()
