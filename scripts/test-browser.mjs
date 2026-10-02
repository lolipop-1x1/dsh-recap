import { fileURLToPath } from 'node:url'
process.chdir(fileURLToPath(new URL('..', import.meta.url)))
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { runSettingsSlotsRegression } from './test-settings-slots.mjs'
const result = await build({
  entryPoints: ['tests/browser-fixture.tsx'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  write: false,
})
const html = await readFile('tests/browser-fixture.html', 'utf8')
const server = createServer((req, res) => {
  if (req.url === '/favicon.ico') {
    res.writeHead(204)
    res.end()
    return
  }
  res.setHeader(
    'content-type',
    req.url === '/fixture.js' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8',
  )
  res.end(req.url === '/fixture.js' ? result.outputFiles[0].contents : html)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const executablePath =
  process.env.CHROME_PATH ||
  (process.platform === 'darwin' && existsSync(macChrome) ? macChrome : undefined)
let browser
const checks = [],
  errors = []
try {
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
  const page = await browser.newPage({
    viewport: { width: 1100, height: 900 },
    reducedMotion: 'reduce',
  })
  page.setDefaultTimeout(10000)
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  const banner = page.getByRole('region', { name: '会话回顾' })
  await page.waitForFunction(() => window.recapTest?.calls.some((call) => call.route === 'state'))
  assert.equal(await banner.count(), 0)
  checks.push('Opening a page and polling after presence initialization keep cached recap hidden')
  await page.evaluate(() => window.recapTest.show())
  await banner.waitFor({ state: 'visible' })
  assert.equal(await page.getByRole('dialog').count(), 0)
  checks.push('Historical settings command does not open a dialog')
  await page.evaluate(() => {
    const fixture = document.createElement('div')
    fixture.id = 'command-spacing-fixture'
    fixture.style.display = 'flex'
    fixture.style.flexDirection = 'column'
    fixture.innerHTML =
      Array.from(
        { length: 12 },
        () =>
          '<div data-chat-flow-kind="command" style="margin-top:6px"><div data-dshr-command="true"></div></div>',
      ).join('') +
      '<div data-chat-flow-kind="command" style="margin-top:6px"><div data-dshr-command="true">recap 内容</div></div>' +
      '<div data-chat-flow-kind="command" style="margin-top:6px">其他命令</div>'
    document.body.append(fixture)
  })
  const commandRows = page.locator('#command-spacing-fixture > div')
  for (let i = 0; i < 12; i++)
    assert.equal(await commandRows.nth(i).evaluate((el) => getComputedStyle(el).display), 'none')
  assert.equal(await commandRows.nth(12).evaluate((el) => getComputedStyle(el).marginTop), '6px')
  assert.equal(await commandRows.nth(13).evaluate((el) => getComputedStyle(el).display), 'block')
  await page.locator('#command-spacing-fixture').evaluate((el) => el.remove())
  checks.push(
    'Empty recap command rows do not accumulate spacing; visible and other commands retain layout',
  )
  checks.push('Chinese compact recap renders')
  await mkdir('test-results/screenshots', { recursive: true })
  await banner.screenshot({ path: 'test-results/screenshots/preview-banner.png' })
  assert.equal(await page.getByRole('region', { name: '会话回顾', exact: true }).count(), 1)
  assert.doesNotMatch(await banner.innerText(), /最近请求|上次回复|会话标题|上下文占用|模型耗时/)
  assert.match(await banner.innerText(), /执行灰度环境回归/)
  assert.equal(await banner.locator('.dshr-card').count(), 0)
  assert.equal(await banner.evaluate((e) => getComputedStyle(e).borderTopWidth), '0px')
  assert.match(await banner.innerText(), /recap/)
  checks.push('One compact text recap, without a card or duplicate content')
  await page.setViewportSize({ width: 390, height: 844 })
  const preview = banner.locator('.dshr-summary')
  const collapsed = await preview.evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    line: parseFloat(getComputedStyle(element).lineHeight),
    full: element.scrollHeight,
  }))
  assert.ok(collapsed.height <= collapsed.line * 3 + 1)
  assert.ok(collapsed.full > collapsed.height)
  await banner.getByRole('button', { name: '展开会话回顾', exact: true }).click()
  assert.equal(
    await banner
      .getByRole('button', { name: '收起会话回顾', exact: true })
      .getAttribute('aria-expanded'),
    'true',
  )
  assert.ok(
    (await preview.evaluate((element) => element.getBoundingClientRect().height)) >
      collapsed.height,
  )
  await banner.getByRole('button', { name: '收起会话回顾', exact: true }).click()
  checks.push('Three-line preview expands and collapses without duplicating text')
  assert.ok(Array.from(await preview.innerText()).length <= 400)
  await page.setViewportSize({ width: 1100, height: 900 })
  checks.push('Character-bounded recap wraps to the chat width')
  await page.screenshot({ path: 'test-results/screenshots/preview-light.png', fullPage: true })
  await page.getByLabel('几分钟没操作后回顾', { exact: true }).fill('5')

  await page.getByText('已保存，即时生效', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '重新读取', exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: '保存设置', exact: true }).count(), 0)
  assert.equal(await page.getByLabel('生成方式', { exact: true }).count(), 0)
  checks.push('Settings save automatically without a save button or generation mode')
  const save = await page.evaluate(() =>
    window.recapTest.calls.filter((call) => call.route === 'save-settings').at(-1),
  )
  assert.deepEqual(save.body.patch, { idleMinutes: 5 })
  assert.equal(save.body.revision, 0)
  checks.push('Only changed fields and expected revision are submitted')
  // 无效数值不发请求，修正后才自动保存。
  const savesBeforeInvalid = await page.evaluate(
    () => window.recapTest.calls.filter((c) => c.route === 'save-settings').length,
  )
  await page.getByLabel('输出 token 上限', { exact: true }).fill('1')
  await page.getByRole('alert').waitFor()
  assert.equal(
    await page.evaluate(
      () => window.recapTest.calls.filter((c) => c.route === 'save-settings').length,
    ),
    savesBeforeInvalid,
  )
  await page.getByLabel('输出 token 上限', { exact: true }).fill('300')
  await page.getByText('已保存，即时生效', { exact: true }).waitFor()
  checks.push('Invalid numeric drafts stay local and valid corrections save automatically')
  const modelPicker = page.getByLabel('回顾使用的模型', { exact: true })
  assert.equal(await modelPicker.inputValue(), '')
  await modelPicker.selectOption({ label: '轻量模型' })
  await page.getByText('已保存，即时生效', { exact: true }).waitFor()
  const modelSave = await page.evaluate(() =>
    window.recapTest.calls.filter((c) => c.route === 'save-settings').at(-1),
  )
  assert.deepEqual(modelSave.body.patch, { provider: 'configured', model: 'small' })
  await modelPicker.selectOption('')
  await page.getByText('已保存，即时生效', { exact: true }).waitFor()
  const followSave = await page.evaluate(() =>
    window.recapTest.calls.filter((c) => c.route === 'save-settings').at(-1),
  )
  assert.deepEqual(followSave.body.patch, { provider: '', model: '' })
  checks.push('Configured models save provider and model together; follow mode clears both')
  await page.evaluate(() => window.recapTest.conflict())
  await page.getByLabel('几分钟没操作后回顾', { exact: true }).fill('17')

  await page.getByRole('alert').waitFor()
  assert.equal(await page.getByLabel('几分钟没操作后回顾', { exact: true }).inputValue(), '17')
  checks.push('Revision conflict retains the user draft')
  await page.getByRole('button', { name: '重新读取', exact: true }).click()
  await page.waitForFunction(
    () => document.querySelector('#dshr-setting-idleMinutes')?.value === '17',
  )
  await page.getByRole('button', { name: '重试保存', exact: true }).click()
  await page.getByText('已保存，即时生效', { exact: true }).waitFor()
  checks.push('Reload keeps the draft; explicit retry uses the latest revision')
  await page.evaluate(() => window.recapTest.locale('en'))
  await page.getByRole('heading', { name: 'Recap', exact: true }).waitFor()
  await page.evaluate(() => window.recapTest.show())
  const english = page.getByRole('region', { name: 'Recap', exact: true })
  await english.waitFor({ state: 'visible' })
  checks.push('Live language switching works')
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await page.screenshot({ path: 'test-results/screenshots/preview-dark.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  assert.equal(await page.getByRole('region', { name: 'Recap', exact: true }).count(), 1)
  assert.equal(
    await english
      .locator('.dshr-summary')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
    true,
  )
  await page.screenshot({ path: 'test-results/screenshots/preview-mobile.png', fullPage: true })
  checks.push('Narrow-screen layout has no horizontal overflow')
  assert.equal(
    await page.getByRole('button', { name: 'Open recap settings', exact: true }).count(),
    0,
  )
  await page.getByRole('button', { name: 'Run settings command', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Recap settings', exact: true })
  await dialog.waitFor({ state: 'visible' })
  await dialog.getByLabel('Idle threshold (minutes)', { exact: true }).fill('8')
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  await page.getByText('Saved; active immediately', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Run settings command', exact: true }).click()
  assert.equal(
    await dialog.getByLabel('Idle threshold (minutes)', { exact: true }).inputValue(),
    '8',
  )
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: 'Remount settings command', exact: true }).click()
  await page.waitForTimeout(100)
  assert.equal(await page.getByRole('dialog').count(), 0)
  checks.push('Closing and remounting the same settings command does not reopen the dialog')
  checks.push(
    'New settings command opens the dialog directly without a launch button; immediate close saves changes and Escape closes it',
  )
  await page.getByRole('button', { name: 'Run settings command', exact: true }).click()
  await dialog.waitFor({ state: 'visible' })
  await page.evaluate(() => window.recapTest.conflict())
  await dialog.getByLabel('Idle threshold (minutes)', { exact: true }).fill('9')
  await dialog.getByRole('alert').waitFor()
  await dialog.getByRole('button', { name: 'Reload', exact: true }).click()
  await dialog.getByRole('alert').waitFor({ state: 'hidden' })
  const savesAfterConflict = await page.evaluate(
    () => window.recapTest.calls.filter((c) => c.route === 'save-settings').length,
  )
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: 'Run settings command', exact: true }).click()
  await dialog.waitFor({ state: 'visible' })
  assert.equal(
    await dialog.getByLabel('Idle threshold (minutes)', { exact: true }).inputValue(),
    '9',
  )
  await dialog.getByLabel('Idle threshold (minutes)', { exact: true }).fill('10')
  await dialog.getByRole('heading', { name: 'Recap', exact: true }).click()
  await page.waitForTimeout(600)
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(
    await page.evaluate(
      () => window.recapTest.calls.filter((c) => c.route === 'save-settings').length,
    ),
    savesAfterConflict,
  )
  await page.getByRole('button', { name: 'Run settings command', exact: true }).click()
  await dialog.waitFor({ state: 'visible' })
  await dialog.getByRole('button', { name: 'Retry save', exact: true }).click()
  await dialog.getByText('Saved; active immediately', { exact: true }).waitFor()
  assert.equal(
    await page.evaluate(
      () => window.recapTest.calls.filter((c) => c.route === 'save-settings').length,
    ),
    savesAfterConflict + 1,
  )
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  checks.push(
    'Conflict drafts stay blocked through reload, close, remount, edit and blur until Retry',
  )
  await page.evaluate(() => window.recapTest.unavailable())
  await english.waitFor({ state: 'detached' })
  await page.waitForTimeout(2200)
  assert.doesNotMatch(
    await page.locator('main').innerText(),
    /not loaded yet|nothing to recap|暂无可回顾|会话尚未加载/,
  )
  checks.push('Loading sessions and background API errors stay quiet')
  await page.evaluate(() => window.recapTest.showAuto())
  await english.waitFor({ state: 'visible' })
  assert.equal(await english.count(), 1)
  await page.evaluate(() => window.recapTest.continue())
  await english.waitFor({ state: 'detached' })
  checks.push('Continuing conversation removes the automatic recap')
  await page.evaluate(() => window.recapTest.unmount())
  await page.waitForTimeout(150)
  const count = await page.evaluate(() => window.recapTest.calls.length)
  await page.waitForTimeout(2300)
  assert.equal(await page.evaluate(() => window.recapTest.calls.length), count)
  checks.push('Unmount stops timers and network polling')
  assert.deepEqual(errors, [])
  checks.push('No uncaught browser errors')
  await mkdir('test-results', { recursive: true })
  await writeFile(
    'test-results/browser.json',
    JSON.stringify({ browser: browser.version(), checks, count: checks.length, errors }, null, 2),
  )
  console.log(`Browser checks passed: ${checks.length} (${browser.version()})`)
  for (const check of checks) console.log(`  ✓ ${check}`)
} finally {
  await browser?.close()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
}
await runSettingsSlotsRegression()
