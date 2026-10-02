import { build } from 'esbuild'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
process.chdir(fileURLToPath(new URL('..', import.meta.url)))
const directory = await mkdtemp(join(tmpdir(), 'dsh-recap-config-'))
try {
  const output = join(directory, 'config.mjs')
  await build({
    entryPoints: ['src/core/config.ts'],
    outfile: output,
    bundle: true,
    format: 'esm',
    platform: 'node',
  })
  const { FIELDS } = await import(pathToFileURL(output).href)
  const lines = [
    '# 配置说明 / Configuration',
    '',
    '由 `npm run docs:config` 从唯一字段定义自动生成。菜单显示语言跟随 Harness；回顾输出语言可单独设置。',
    '',
    '| 字段 | 中文 / English | 默认值 | 类型与范围 | 说明 |',
    '| --- | --- | --- | --- | --- |',
  ]
  for (const field of FIELDS) {
    const bounds =
      field.choices?.join(' / ') ??
      (field.min === undefined ? field.kind : `${field.min}–${field.max}`)
    lines.push(
      `| \`${field.key}\` | ${field.label.zh} / ${field.label.en} | \`${JSON.stringify(field.default)}\` | ${bounds} | ${field.help.zh || '—'} |`,
    )
  }
  lines.push(
    '',
    '所有设置通过原生 volatile 配置持久化。保存必须携带读取时的 revision；冲突时保留草稿，不做静默覆盖。服务商与模型必须同时填写或同时留空。',
    '',
    '自动总开关不影响手动命令；`onCommand` 是单独的命令开关。自动回顾只在当前可见会话闲置时触发，打开或切换会话只重新计时。更改设置会取消旧任务并使旧缓存失效。',
    '',
    '缓存的轮次窗口只控制自动复用；资料变化后默认重新生成。模型失败后的事实回顾可以缓存，手动 refresh 会发起新的尝试。回顾默认展示三行，展开后显示全文；字符上限控制生成长度。',
    '',
    '原生设置服务缺失时，插件仍可提供回顾命令；自定义设置页为只读。已有的闲置设置继续生效。旧 `includeStats`、`onAway`、`awayMinutes`、`onResume`、`onCompact`、`onTurnEnd` 字段仅兼容读取并忽略。',
    '',
  )
  await mkdir('docs', { recursive: true })
  await writeFile('docs/配置说明.md', lines.join('\n'))
} finally {
  await rm(directory, { recursive: true, force: true })
}
