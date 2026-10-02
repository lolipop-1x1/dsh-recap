/** Shared catalog for validation and settings. */
export type Language = 'zh' | 'en'
export interface FieldSpec {
  key: string
  group: 'triggers' | 'generation' | 'display' | 'advanced'
  kind: 'boolean' | 'number' | 'text' | 'select'
  default: boolean | number | string
  label: { zh: string; en: string }
  help: { zh: string; en: string }
  min?: number
  max?: number
  choices?: readonly string[]
}
const field = (
  key: string,
  group: FieldSpec['group'],
  kind: FieldSpec['kind'],
  value: FieldSpec['default'],
  zh: string,
  en: string,
  hintZh = '',
  hintEn = '',
  extra: Partial<FieldSpec> = {},
): FieldSpec => ({
  key,
  group,
  kind,
  default: value,
  label: { zh, en },
  help: { zh: hintZh, en: hintEn },
  ...extra,
})
export const FIELDS: readonly FieldSpec[] = [
  field(
    'autoEnabled',
    'triggers',
    'boolean',
    true,
    '自动回顾总开关',
    'Automatic recaps',
    '不影响手动 /recap。',
    'Manual /recap remains available.',
  ),
  field('onCommand', 'triggers', 'boolean', true, '启用 /recap 命令', 'Enable /recap command'),
  field('onIdle', 'triggers', 'boolean', true, '当前会话闲置时回顾', 'Recap while idle'),
  field(
    'idleMinutes',
    'triggers',
    'number',
    3,
    '几分钟没操作后回顾',
    'Idle threshold (minutes)',
    '只在当前正在展示的会话中触发；切换会话重新计时。',
    'Only in the currently visible session; switching sessions restarts the timer.',
    { min: 0.1, max: 1440 },
  ),
  field(
    'minTurns',
    'triggers',
    'number',
    3,
    '自动回顾的最少完成轮次',
    'Minimum completed turns',
    '',
    '',
    { min: 0, max: 1000 },
  ),
  field(
    'mode',
    'generation',
    'select',
    'hybrid',
    '生成方式',
    'Generation mode',
    'hybrid 使用模型；deterministic 只整理事实。',
    'hybrid uses a model; deterministic only extracts facts.',
    { choices: ['hybrid', 'deterministic'] },
  ),
  field(
    'provider',
    'generation',
    'text',
    '',
    '服务商路由',
    'Provider route',
    '与模型同时留空时跟随当前会话。',
    'Leave both empty to follow this session.',
  ),
  field('model', 'generation', 'text', '', '模型', 'Model'),
  field(
    'language',
    'generation',
    'select',
    'auto',
    '回顾语言',
    'Recap language',
    'auto 跟随 Harness 界面语言。',
    'auto follows the Harness UI locale.',
    { choices: ['auto', 'zh', 'en'] },
  ),
  field(
    'maxTokens',
    'generation',
    'number',
    512,
    '输出 token 上限',
    'Maximum output tokens',
    '',
    '',
    { min: 64, max: 4096 },
  ),
  field(
    'maxSourceMessages',
    'generation',
    'number',
    12,
    '最近消息条数上限',
    'Maximum recent messages',
    '',
    '',
    { min: 1, max: 80 },
  ),
  field(
    'maxSourceChars',
    'generation',
    'number',
    6000,
    '输入素材字符上限',
    'Maximum source characters',
    '',
    '',
    { min: 1000, max: 64000 },
  ),
  field(
    'timeoutSeconds',
    'generation',
    'number',
    20,
    '生成超时秒数',
    'Generation timeout (seconds)',
    '',
    '',
    { min: 2, max: 120 },
  ),
  field(
    'oneLineMaxChars',
    'display',
    'number',
    160,
    '回顾字符上限',
    'Maximum recap characters',
    '默认 160 字符，按页面宽度自动换行。',
    'Defaults to 160 characters and wraps to the available width.',
    { min: 80, max: 1000 },
  ),
  field(
    'includeFilePaths',
    'display',
    'boolean',
    true,
    '包含文件路径',
    'Include file paths',
    '控制摘要素材中的文件列表；消息中的路径不保证去除。',
    'Controls the file list supplied for summarization; paths quoted in messages may remain.',
  ),
  field(
    'cacheTtlTurns',
    'advanced',
    'number',
    0,
    '自动回顾缓存轮次',
    'Automatic cache window (turns)',
    '旧缓存标记过期；0 表示资料变化即重新生成。',
    'Older cached recaps are marked stale; 0 refreshes changed facts.',
    { min: 0, max: 30 },
  ),
  field(
    'autoCooldownSeconds',
    'advanced',
    'number',
    30,
    '自动调用最短间隔（秒）',
    'Automatic cooldown (seconds)',
    '',
    '',
    { min: 0, max: 3600 },
  ),
  field(
    'maxConcurrent',
    'advanced',
    'number',
    2,
    '最多同时生成的会话数',
    'Maximum concurrent generations',
    '',
    '',
    { min: 1, max: 8 },
  ),
  field(
    'maxSessions',
    'advanced',
    'number',
    100,
    '最多缓存会话数',
    'Maximum cached sessions',
    '',
    '',
    { min: 5, max: 1000 },
  ),
  field(
    'injectToModel',
    'advanced',
    'boolean',
    false,
    '将回顾注入主模型',
    'Inject recap into main model',
    '默认关闭。开启会增加模型上下文。',
    'Off by default. Adds a durable context message.',
  ),
]
export interface RecapConfig {
  autoEnabled: boolean
  onCommand: boolean
  onIdle: boolean
  idleMinutes: number
  minTurns: number
  mode: 'hybrid' | 'deterministic'
  provider: string
  model: string
  language: 'auto' | Language
  maxTokens: number
  maxSourceMessages: number
  maxSourceChars: number
  timeoutSeconds: number
  oneLineMaxChars: number
  includeFilePaths: boolean
  cacheTtlTurns: number
  autoCooldownSeconds: number
  maxConcurrent: number
  maxSessions: number
  injectToModel: boolean
}
export const DEFAULTS = Object.freeze(
  Object.fromEntries(FIELDS.map((f) => [f.key, f.default])),
) as Readonly<RecapConfig>
export class RecapError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message)
    this.name = 'RecapError'
  }
}
export function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}
/** Reject invalid or unknown settings; do not silently change the user's input. */
export function validatePatch(input: unknown): Partial<RecapConfig> {
  const data = record(input)
  if (!data) throw new RecapError('INVALID_CONFIG', 'Expected a settings object.')
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    // 兼容读取已移除的旧开关；打开、离开、压缩和每轮结束不再自动触发。
    if (
      ['includeStats', 'onAway', 'onResume', 'onCompact', 'onTurnEnd'].includes(key) &&
      typeof value === 'boolean'
    )
      continue
    if (key === 'awayMinutes' && typeof value === 'number' && Number.isFinite(value)) continue
    const spec = FIELDS.find((f) => f.key === key)
    if (!spec) throw new RecapError('INVALID_CONFIG', `Unknown setting: ${key}`)
    if (spec.kind === 'boolean' && typeof value !== 'boolean')
      throw new RecapError('INVALID_CONFIG', `${key} must be a boolean.`)
    if (spec.kind === 'number') {
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < (spec.min ?? 0) ||
        value > (spec.max ?? Infinity)
      )
        throw new RecapError(
          'INVALID_CONFIG',
          `${key} must be between ${spec.min} and ${spec.max}.`,
        )
      if (key !== 'idleMinutes' && !Number.isSafeInteger(value))
        throw new RecapError('INVALID_CONFIG', `${key} must be an integer.`)
    }
    if (spec.kind === 'select' && (typeof value !== 'string' || !spec.choices?.includes(value)))
      throw new RecapError('INVALID_CONFIG', `Invalid ${key}.`)
    if (
      spec.kind === 'text' &&
      (typeof value !== 'string' || value.length > 256 || /[\u0000-\u001f]/u.test(value))
    )
      throw new RecapError('INVALID_CONFIG', `Invalid ${key}.`)
    out[key] = typeof value === 'string' ? value.trim() : value
  }
  return out as Partial<RecapConfig>
}
export function resolveConfig(input: unknown): RecapConfig {
  const config = { ...DEFAULTS, ...validatePatch(input) }
  if (Boolean(config.provider) !== Boolean(config.model))
    throw new RecapError('INVALID_CONFIG', 'Provider and model must both be set, or both empty.')
  return config
}
export function languageOf(config: RecapConfig, hint = ''): Language {
  return config.language === 'auto' ? (/^zh(?:-|$)/iu.test(hint) ? 'zh' : 'en') : config.language
}
