import { describe, it, expect } from 'vitest'
import { DEFAULTS, resolveConfig, validatePatch } from '../src/core/config.js'
import { initialState, fold, StateSchema } from '../src/core/projection.js'
import { deriveFacts, buildPrompt, factualSummary } from '../src/core/facts.js'
import { redact, textBlocks, line, limit } from '../src/core/text.js'
import { Config } from '../src/host/config.js'
import { fixture } from './helpers.js'
describe('settings contract', () => {
  it('keeps optional behaviors disabled and cost controls bounded', () => {
    expect(DEFAULTS.injectToModel).toBe(false)
    expect(DEFAULTS.onIdle).toBe(true)
    expect(DEFAULTS.idleMinutes).toBe(3)
    expect(DEFAULTS).not.toHaveProperty('onTurnEnd')
    expect(DEFAULTS).not.toHaveProperty('onResume')
    expect(DEFAULTS).not.toHaveProperty('onCompact')
    expect(DEFAULTS.cacheTtlTurns).toBe(0)
    expect(DEFAULTS.maxConcurrent).toBe(2)
  })
  it.each([
    { mystery: true },
    { minTurns: -1 },
    { maxConcurrent: 1.2 },
    { timeoutSeconds: Infinity },
    { onAway: 'true' },
    { language: 'xx' },
    { provider: 'a\nb' },
  ])('rejects invalid patch %j', (patch) => {
    expect(() => validatePatch(patch)).toThrow()
  })
  it('rejects prototype fields', () => {
    expect(() => validatePatch(JSON.parse('{"__proto__":{}}'))).toThrow()
  })
  it('requires a complete model route', () => {
    expect(() => resolveConfig({ provider: 'x' })).toThrow()
    expect(resolveConfig({ provider: ' x ', model: ' y ' }).model).toBe('y')
  })
  it('has a native volatile schema with matching defaults', () => {
    const reference = Config({})
    expect(reference.get()).toEqual(DEFAULTS)
    const schema = Config.toJSON()
    expect(schema.refs[schema.uid]?.meta?.volatile).toBe(true)
  })
  it('ignores the removed statistics setting in existing profiles', () => {
    const config = resolveConfig({
      includeStats: true,
      onAway: true,
      onResume: true,
      onCompact: true,
      onTurnEnd: true,
      awayMinutes: 3,
    })
    expect(config).not.toHaveProperty('includeStats')
    expect(config).not.toHaveProperty('onResume')
    expect(config).not.toHaveProperty('onAway')
    expect(resolveConfig(Config({ includeStats: true }).get())).not.toHaveProperty('includeStats')
  })
})
describe('privacy and text limits', () => {
  it('drops reasoning, image and tool-call blocks', () => {
    expect(
      textBlocks([
        { type: 'reasoning', text: 'private' },
        { type: 'text', text: 'visible' },
        { type: 'tool-call', arguments: 'secret' },
      ]),
    ).toBe('visible')
  })
  it('redacts common credentials and URL passwords', () => {
    // 凭据和域名均为虚构数据，用于验证脱敏。
    expect(redact('token=abc Bearer synthetic123 https://user:secret@example.test')).not.toContain(
      'synthetic123',
    )
    expect(redact('password="example"')).not.toContain('example')
  })
  it('is idempotent after redacting assignments', () => {
    const once = redact('token=abc')
    expect(redact(once)).toBe(once)
  })
  it('counts Unicode characters without broken surrogate pairs', () => {
    expect(limit('😀😀😀', 2)).toBe('😀…')
    expect(Array.from(line('一 二 三', 3))).toHaveLength(3)
  })
})
describe('incremental factual projection', () => {
  it('continues folding a legacy checkpoint without losing conversation facts', () => {
    const f = fixture()
    const s = f.add()
    const restored = StateSchema.parse({ ...s.session.state, lastActivityAt: 123 })
    const next = fold(restored, {
      type: 'session/title',
      seq: s.session.seq,
      time: Date.now(),
      data: { title: '会话回顾' },
    })
    expect(next.messages).toEqual(s.session.state.messages)
    expect(next.completedTurns).toBe(3)
    expect(next.watermark).toBe(s.session.seq)
    f.engine.dispose()
  })
  it('ignores unsupported events without changing the reference', () => {
    const state = initialState()
    expect(fold(state, { type: 'random', seq: 1, time: 1, data: {} })).toBe(state)
  })
  it('does not invent step failures or include context injection', () => {
    const f = fixture()
    const s = f.add()
    s.append('step/end', { turn: 3, step: 4, status: 'failed', error: 'fake' })
    s.append('user/message', {
      source: { kind: 'recap', recapId: 'recap-1' },
      content: [{ type: 'text', text: 'do not include me' }],
    })
    expect(s.session.state.errors).toEqual([])
    expect(s.session.state.lastInjectedId).toBe('recap-1')
    expect(JSON.stringify(s.session.state.messages)).not.toContain('do not include me')
    f.engine.dispose()
  })
  it('accepts only matching, successful block-based compaction', () => {
    const f = fixture()
    const s = f.add()
    s.append('compaction/summary', {
      compactionId: 'c1',
      summary: [{ type: 'text', text: '# Current Work\nFix permissions' }],
    })
    expect(s.session.state.checkpoint).toBeNull()
    s.append('compaction/end', { compactionId: 'c1', error: 'failed' })
    expect(s.session.state.checkpoint).toBeNull()
    s.append('compaction/summary', { compactionId: 'c2', summary: 'old unsupported string' })
    expect(s.session.state.pendingCheckpoint).toBeNull()
    s.append('compaction/summary', {
      compactionId: 'c3',
      summary: [{ type: 'text', text: 'valid checkpoint' }],
    })
    s.append('compaction/end', { compactionId: 'c3' })
    expect(s.session.state.checkpoint?.text).toBe('valid checkpoint')
    f.engine.dispose()
  })
  it('bounds retained messages, errors and file markers', () => {
    const f = fixture()
    const s = f.add()
    for (let i = 0; i < 300; i++) {
      s.turn()
      s.append('tool/result', {
        message: { isError: true, content: [{ type: 'text', text: 'x'.repeat(3000) }] },
      })
      s.append('workspace/changes', { turn: i })
    }
    expect(s.session.state.messages).toHaveLength(80)
    expect(s.session.state.errors).toHaveLength(10)
    expect(s.session.state.fileEvents).toHaveLength(20)
    expect(StateSchema.safeParse(s.session.state).success).toBe(true)
    f.engine.dispose()
  })
  it('updates the watermark for todo mutations', () => {
    const f = fixture()
    const s = f.add()
    const before = s.session.state.watermark
    s.append('todo/write', { todos: [] })
    expect(s.session.state.watermark).toBeGreaterThan(before)
    f.engine.dispose()
  })
})
describe('prompt construction', () => {
  it('does not claim observed replies were completed work', () => {
    const f = fixture()
    const s = f.add()
    const facts = deriveFacts('s', s.session.state, resolveConfig({}))
    facts.latestResponse = '这是一段不应该复制进回顾的长回复。'.repeat(100)
    const recap = factualSummary(facts, 'zh', 400)
    expect(recap).toBe('')
    expect(recap).not.toContain('长回复')
    expect(recap).not.toContain('上次回复')
    f.engine.dispose()
  })
  it('retains valid JSON within the source budget, including escaped text', () => {
    const f = fixture()
    const s = f.add()
    const config = resolveConfig({ maxSourceChars: 1000 })
    const facts = deriveFacts('s', s.session.state, config)
    facts.latestRequest = '"\\'.repeat(4000)
    facts.latestResponse = facts.latestRequest
    const result = buildPrompt(facts, config, 'en')
    expect(() => JSON.parse(result.input)).not.toThrow()
    expect(result.input.length).toBeLessThanOrEqual(1000)
    expect(result.system).toContain('untrusted DATA')
    expect(result.system).toContain('one or two short sentences')
    f.engine.dispose()
  })
  it('does not reclassify historical errors as active blockers', () => {
    const f = fixture()
    const s = f.add()
    s.append('tool/result', {
      message: { isError: true, content: [{ type: 'text', text: 'transient timeout' }] },
    })
    const facts = deriveFacts('s', s.session.state, resolveConfig({}))
    const input = JSON.parse(buildPrompt(facts, resolveConfig({}), 'en').input)
    expect(input.historicalErrors).toEqual([
      expect.objectContaining({ kind: 'tool', text: 'transient timeout' }),
    ])
    expect(input.blockedReason).toBe('')
    expect(input.goalPhase).toBeNull()
    f.engine.dispose()
  })
})

import { errorCode } from '../src/core/text.js'
it('never exposes an arbitrary provider exception code', () => {
  expect(errorCode({ code: 'synthetic-private-provider-detail' })).toBe('GENERATION_FAILED')
})

it('labels completed goals as completed in factual fallback', () => {
  const f = fixture()
  const s = f.add()
  const facts = deriveFacts('s', s.session.state, resolveConfig({}))
  facts.goal = '实现便签功能'
  facts.goalPhase = 'complete'
  facts.latestRequest = '谢谢'
  expect(factualSummary(facts, 'zh', 400)).toContain('已完成目标：实现便签功能')
  expect(factualSummary(facts, 'zh', 400)).not.toContain('当前任务：实现便签功能')
  expect(factualSummary(facts, 'en', 400)).toContain('Completed goal: 实现便签功能')
  f.engine.dispose()
})

it('兼容但忽略旧文件路径开关，不再单独收集文件列表', () => {
  const config = resolveConfig({ includeFilePaths: true })
  expect(config).not.toHaveProperty('includeFilePaths')
  const facts = deriveFacts('s', initialState(), config, {
    files: [{ path: '/private/demo', added: 1, deleted: 0, turn: 1 }],
  })
  expect(facts.files).toEqual([])
  expect(buildPrompt(facts, config, 'zh').input).not.toContain('/private/demo')
})
