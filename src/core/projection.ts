import { z } from 'zod'
import { record } from './config.js'
import { line, textBlocks } from './text.js'
export const PROJECTION_KEY = 'dshRecapFacts'
const Message = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  turn: z.number(),
  seq: z.number(),
  time: z.number(),
})
const ErrorRow = z.object({
  kind: z.enum(['tool', 'model', 'interrupted']),
  text: z.string(),
  turn: z.number(),
  seq: z.number(),
  time: z.number(),
})
const Checkpoint = z.object({ id: z.string(), text: z.string(), seq: z.number(), time: z.number() })
export const StateSchema = z.object({
  watermark: z.number(),
  turn: z.number(),
  completedTurns: z.number(),
  steps: z.number(),
  toolCalls: z.number(),
  openTurn: z.boolean(),
  turnHadContent: z.boolean(),
  messages: z.array(Message).max(80),
  errors: z.array(ErrorRow).max(10),
  fileEvents: z.array(z.object({ turn: z.number(), seq: z.number() })).max(20),
  checkpoint: Checkpoint.nullable(),
  pendingCheckpoint: Checkpoint.nullable(),
  lastInjectedId: z.string().nullable(),
})
export type FoldState = z.infer<typeof StateSchema>
export type MessageSnippet = z.infer<typeof Message>
export type HistoricalError = z.infer<typeof ErrorRow>
export interface LogEvent {
  type: string
  seq: number
  time: number
  data: unknown
}
export function initialState(): FoldState {
  return {
    watermark: -1,
    turn: 0,
    completedTurns: 0,
    steps: 0,
    toolCalls: 0,
    openTurn: false,
    turnHadContent: false,
    messages: [],
    errors: [],
    fileEvents: [],
    checkpoint: null,
    pendingCheckpoint: null,
    lastInjectedId: null,
  }
}
const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
/** Pure, JSON-only, bounded and reference-stable for irrelevant events. */
export function fold(state: FoldState, event: LogEvent): FoldState {
  const data = record(event.data) ?? {}
  const turn = num(data.turn, state.turn)
  const changed = { watermark: event.seq }
  const appendError = (kind: HistoricalError['kind'], text: string): FoldState => ({
    ...state,
    ...changed,
    errors: [
      ...state.errors,
      { kind, text: line(text, 240), turn, seq: event.seq, time: event.time },
    ].slice(-10),
  })
  switch (event.type) {
    case 'session/title':
    case 'todo/write':
    case 'goal/change':
      return { ...state, ...changed }
    case 'turn/start':
      return { ...state, turn, openTurn: true, turnHadContent: false }
    case 'step/end':
      return { ...state, ...changed, steps: state.steps + 1, turnHadContent: true }
    case 'turn/end':
      return {
        ...state,
        ...changed,
        openTurn: false,
        completedTurns: state.completedTurns + Number(state.openTurn && state.turnHadContent),
      }
    case 'user/message': {
      const source = record(data.source)
      if (source?.kind === 'recap') {
        return typeof source.recapId === 'string'
          ? { ...state, lastInjectedId: source.recapId }
          : state
      }
      if (source?.kind !== 'user') return state
      const text = textBlocks(data.content)
      if (!text.trim()) return state
      return {
        ...state,
        ...changed,
        turnHadContent: true,
        messages: [
          ...state.messages,
          { role: 'user' as const, text, turn, seq: event.seq, time: event.time },
        ].slice(-80),
      }
    }
    case 'assistant/message': {
      const text = textBlocks(record(data.message)?.content)
      const next =
        data.interrupted === true
          ? appendError('interrupted', 'The last assistant response was interrupted.')
          : state
      if (!text.trim()) return next
      return {
        ...next,
        ...changed,
        turnHadContent: true,
        messages: [
          ...state.messages,
          { role: 'assistant' as const, text, turn, seq: event.seq, time: event.time },
        ].slice(-80),
      }
    }
    case 'tool/call':
      return { ...state, toolCalls: state.toolCalls + 1 }
    case 'tool/result': {
      const message = record(data.message)
      return message?.isError === true
        ? appendError('tool', textBlocks(message.content, 240) || 'A tool call failed.')
        : { ...state, ...changed }
    }
    case 'assistant/attempt': {
      if (!Array.isArray(data.stream)) return state
      for (let i = data.stream.length - 1; i >= 0; i--) {
        const chunk = record(record(data.stream[i])?.chunk)
        const reason = record(chunk?.reason)
        if (chunk?.type === 'finish' && (reason?.kind === 'error' || reason?.kind === 'aborted')) {
          const failure = record(reason.failure)
          return appendError(
            'model',
            typeof failure?.message === 'string'
              ? failure.message
              : 'A model attempt did not complete.',
          )
        }
      }
      return state
    }
    case 'workspace/changes':
      return {
        ...state,
        ...changed,
        fileEvents: [
          ...state.fileEvents.filter((e) => e.turn !== turn),
          { turn, seq: event.seq },
        ].slice(-20),
      }
    case 'compaction/start':
      return state.pendingCheckpoint === null ? state : { ...state, pendingCheckpoint: null }
    case 'compaction/summary': {
      const text = textBlocks(data.summary, 8000)
      if (!text.trim() || typeof data.compactionId !== 'string') return state
      return {
        ...state,
        pendingCheckpoint: { id: data.compactionId, text, seq: event.seq, time: event.time },
      }
    }
    case 'compaction/end': {
      const checkpoint = state.pendingCheckpoint
      if (!checkpoint || checkpoint.id !== data.compactionId)
        return state.pendingCheckpoint === null ? state : { ...state, pendingCheckpoint: null }
      if (typeof data.error === 'string') return { ...state, pendingCheckpoint: null }
      return { ...state, ...changed, checkpoint, pendingCheckpoint: null }
    }
    default:
      return state
  }
}
