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
    '自动总开关不影响手动命令；`onCommand` 是单独的命令开关。自动回顾只在当前可见会话闲置时触发，打开或切换会话只重新计时。调度设置（如闲置阈值和并发数）更改不会清除已有回顾或使缓存过期；关闭自动回顾或闲置触发会取消正在进行的自动任务。影响回顾内容的设置（模型、语言、预算、超时和目标字数等）更改会取消旧任务，保留已有回顾并标记「较早回顾」，下次请求按新配置重新生成。',
    '',
    '缓存的轮次窗口只控制自动复用；资料变化后默认重新生成。模型生成失败、超时或返回不完整内容时保留已有摘要并显示错误，不自动改用事实回顾；没有旧摘要时只显示失败提示。手动 `/recap refresh` 跳过缓存重新尝试。回顾默认展示三行，展开后显示全文；目标字数用于提示模型生成长度，不硬截断正常结果。',
    '',
    '原生设置服务缺失时，插件仍可提供回顾命令；自定义设置页为只读。已有的闲置设置继续生效。旧 `includeStats`、`onAway`、`awayMinutes`、`onResume`、`onCompact`、`onTurnEnd` 字段仅兼容读取并忽略。',
    '',
  )
  await mkdir('docs', { recursive: true })
  await writeFile('docs/配置说明.md', lines.join('\n'))
} finally {
  await rm(directory, { recursive: true, force: true })
}
