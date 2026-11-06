import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-api-session-controller/types'
import type {} from '@deepseek-ai/dsh-workspace-changes'
import { BlockAssembler } from '@deepseek-ai/dsh-llm'
import { RecapError, type RecapConfig, type Language } from '../core/config.js'
import { buildPrompt, deriveFacts, type Facts } from '../core/facts.js'
import type { FoldState } from '../core/projection.js'
import type { LiveSnapshot, ModelResult } from '../core/contracts.js'
import { textBlocks } from '../core/text.js'
// 最低支持 SDK 依赖此类型表；新版从投影注册的泛型推导状态。
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    dshRecapFacts: FoldState
  }
}
export function snapshot(
  ctx: Context,
  id: string,
  config: RecapConfig,
  readFacts: (session: Session) => FoldState,
): LiveSnapshot | undefined {
  const agent = ctx.agents.get(id as SessionId)
  if (!agent) return undefined
  const state = readFacts(agent.session)
  const extra = ctx.sessionProjections.snapshot(agent.session, ['todos', 'goal', 'title']).values
  return {
    instance: agent,
    running: agent.status === 'running',
    subagent: agent.session.header.origin === 'subagent',
    facts: deriveFacts(id, state, config, {
      title: extra.title,
      todos: extra.todos,
      goal: extra.goal,
    }),
  }
}
export async function generate(
  ctx: Context,
  facts: Facts,
  config: RecapConfig,
  language: Language,
  signal: AbortSignal,
): Promise<ModelResult> {
  const agent = ctx.agents.get(facts.sessionId as SessionId)
  const llm = ctx.get('llm')
  if (!agent || !llm)
    throw new RecapError('MODEL_UNAVAILABLE', 'No model service is available.', 503)
  const selected = ctx.sessionProjections.snapshot(agent.session, ['modelSelection']).values
    .modelSelection?.next
  const header = agent.session.requestHeader()?.config
  const route =
    config.provider && config.model
      ? config
      : (selected ?? (header?.provider && header.model ? header : agent.options))
  const { provider, model } = route
  if (!provider || !model)
    throw new RecapError('MODEL_UNAVAILABLE', 'This session has no model route.', 503)
  const prompt = buildPrompt(facts, config, language)
  const assembler = new BlockAssembler()
  let size = 0,
    chunks = 0,
    completed = false
  // 不冒用宿主其他功能的用途标识，回顾请求保持独立。
  for await (const chunk of llm.stream({
    provider,
    model,
    system: prompt.system,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt.input }] }],
    maxTokens: config.maxTokens,
    signal,
    sessionId: agent.id,
  })) {
    if (signal.aborted) throw new RecapError('CANCELLED', 'Request cancelled.', 409)
    size += JSON.stringify(chunk).length
    if (++chunks > 20000 || size > 2_000_000)
      throw new RecapError('OUTPUT_TOO_LARGE', 'Model response exceeded the safety limit.', 502)
    assembler.push(chunk)
    if (chunk.type === 'finish') {
      completed = true
      break
    }
  }
  if (!completed || assembler.finish.kind !== 'stop')
    throw new RecapError('INCOMPLETE_RESPONSE', 'The model did not finish a complete recap.', 502)
  const text = textBlocks(assembler.blocks(), 8001)
  if (Array.from(text).length > 8000)
    throw new RecapError('OUTPUT_TOO_LARGE', 'Recap exceeds the safety limit.', 502)
  if (!text.trim()) throw new RecapError('EMPTY_RESPONSE', 'The model returned no recap text.', 502)
  return { text, provider, model }
}
// Optional projection domains: declaration imports only; do not bundle another service instance.
import type {} from '@deepseek-ai/dsh-tool-todo'
import type {} from '@deepseek-ai/dsh-goal'

import type {} from '@deepseek-ai/dsh-session-title/types'
