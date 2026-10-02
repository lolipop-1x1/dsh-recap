import { RecapError } from './config.js'
/** Basic credential-pattern scrubbing; this is not a complete DLP system. */
export function redact(text: string): string {
  return text
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gu,
      '[REDACTED PRIVATE KEY]',
    )
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,})\b/gu,
      '[REDACTED]',
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/giu, 'Bearer [REDACTED]')
    .replace(
      /\b((?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|passwd|secret|authorization)\s*["']?\s*[:=]\s*)(?:\[REDACTED\]|"[^"\n]*"|'[^'\n]*'|[^\s,;&}\]]+)/giu,
      '$1[REDACTED]',
    )
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/giu, '$1[REDACTED]@')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
}
export function limit(text: string, max: number): string {
  const chars = Array.from(text)
  return chars.length <= max ? text : chars.slice(0, Math.max(0, max - 1)).join('') + '…'
}
export function line(text: string, max = 400): string {
  return limit(redact(text).replace(/\s+/gu, ' ').trim(), max)
}
export function textBlocks(value: unknown, max = 2000): string {
  if (!Array.isArray(value)) return ''
  // Never serialize unknown blocks: reasoning, tool calls, images and files stay out.
  return limit(
    redact(
      value
        .flatMap((item) => {
          if (typeof item !== 'object' || item === null) return []
          const block = item as Record<string, unknown>
          return block.type === 'text' && typeof block.text === 'string' ? [block.text] : []
        })
        .join('\n'),
    ),
    max,
  )
}
export function errorCode(error: unknown): string {
  if (error instanceof RecapError) return error.code
  return error instanceof Error && error.name === 'AbortError' ? 'CANCELLED' : 'GENERATION_FAILED'
}
