import { useSyncExternalStore } from 'react'
import type { Language } from '../core/config.js'
import { errorCode } from '../core/text.js'
export interface LocaleAccess {
  subscribe(listener: () => void): () => void
  active(): string
}
export function useLanguage(locale: LocaleAccess): Language {
  return /^zh(?:-|$)/iu.test(useSyncExternalStore(locale.subscribe, locale.active, locale.active))
    ? 'zh'
    : 'en'
}
const copy = {
  title: ['会话回顾', 'Recap'],
  expand: ['展开', 'Expand'],
  collapse: ['收起', 'Collapse'],
  generating: ['正在整理回顾…', 'Preparing your recap…'],
  facts: ['事实整理', 'Extracted facts'],
  stale: ['较早回顾', 'Earlier recap'],
  subtitle: ['回来时，一眼接上之前的工作。', 'Return to your work without losing the thread.'],
  triggers: ['触发方式', 'Triggers'],
  generation: ['生成与用量', 'Generation & usage'],
  display: ['展示', 'Display'],
  advanced: ['高级与隐私', 'Advanced & privacy'],
  recapModel: ['回顾使用的模型', 'Recap model'],
  followModel: ['跟随当前会话模型', 'Follow conversation model'],
  modelHelp: [
    '默认使用主模型，也可选择已配置的其他模型来控制用量。',
    'Use the conversation model, or choose another configured model to control usage.',
  ],
  modelError: [
    '部分模型列表暂时不可用，当前选择保持不变。',
    'Some models are unavailable; your current selection is unchanged.',
  ],
  autoSave: ['修改后自动保存', 'Changes save automatically'],
  unsaved: ['等待保存…', 'Waiting to save…'],
  saving: ['保存中…', 'Saving…'],
  saved: ['已保存，即时生效', 'Saved; active immediately'],
  reload: ['重新读取', 'Reload'],
  reset: ['恢复默认设置', 'Restore defaults'],
  loading: ['读取设置…', 'Loading settings…'],
  conflict: [
    '设置已在别处更新。草稿已保留；请重新读取后再修改。',
    'Settings changed elsewhere. Your draft is retained; reload before editing again.',
  ],
  injection: [
    '已开启上下文注入：回顾会成为主模型可见的持久消息。',
    'Context injection is enabled: recaps become durable, model-visible messages.',
  ],
  readOnly: [
    '此安装没有可写的配置条目，请通过创造模式安装完整 bundle。',
    'No writable entry is available. Install the complete bundle through Creator mode.',
  ],
} as const
export type CopyKey = keyof typeof copy
export function t(language: Language, key: CopyKey): string {
  return copy[key][language === 'zh' ? 0 : 1]
}
export function errorText(error: unknown, language: Language): string {
  const code = errorCode(error)
  if (code === 'CONFLICT') return t(language, 'conflict')
  if (code === 'READ_ONLY') return t(language, 'readOnly')
  if (code === 'AUTH_REQUIRED')
    return language === 'zh'
      ? '连接认证已失效，请重新连接 Harness。'
      : 'Authentication expired. Reconnect to Harness.'
  if (code === 'NOT_LIVE')
    return language === 'zh'
      ? '会话尚未加载，连接恢复后会自动重试。'
      : 'This session is not loaded yet; retrying after reconnect.'
  if (code === 'INVALID_CONFIG')
    return language === 'zh'
      ? '设置值不合法，请检查数值范围以及服务商和模型是否同时填写。'
      : 'Invalid settings. Check ranges and set both provider and model, or neither.'
  return language === 'zh'
    ? '暂时无法获取回顾，请检查连接后重试。'
    : 'Recap is temporarily unavailable. Check your connection and retry.'
}
