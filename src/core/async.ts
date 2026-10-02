import { RecapError } from './config.js'
export function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof RecapError
    ? signal.reason
    : new RecapError('CANCELLED', 'Request cancelled.', 409)
}
/** An uncooperative promise cannot hold local state or an admission slot forever. */
export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void promise.catch(() => undefined)
    return Promise.reject(abortReason(signal))
  }
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => {
      cleanup()
      reject(abortReason(signal))
    }
    const cleanup = (): void => signal.removeEventListener('abort', abort)
    signal.addEventListener('abort', abort, { once: true })
    promise.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error) => {
        cleanup()
        reject(error)
      },
    )
  })
}
interface Waiting {
  signal: AbortSignal
  priority: boolean
  resolve(release: () => void): void
  reject(error: Error): void
  abort(): void
}
export class WorkGate {
  private active = 0
  private waiting: Waiting[] = []
  private closed = false
  constructor(private readonly limit: () => number) {}
  get size(): number {
    return this.active
  }
  get queued(): number {
    return this.waiting.length
  }
  async run<T>(signal: AbortSignal, priority: boolean, work: () => Promise<T>): Promise<T> {
    const release = await this.acquire(signal, priority)
    try {
      return await raceAbort(
        Promise.resolve().then(() => {
          if (signal.aborted) throw abortReason(signal)
          return work()
        }),
        signal,
      )
    } finally {
      release()
    }
  }
  /** Promote only waiting work; keep existing manual requests in FIFO order. */
  promote(signal: AbortSignal): void {
    if (this.closed || signal.aborted) return
    const index = this.waiting.findIndex((item) => item.signal === signal)
    const item = this.waiting[index]
    if (!item || item.priority) return
    this.waiting.splice(index, 1)
    item.priority = true
    const before = this.waiting.findIndex((waiting) => !waiting.priority)
    if (before < 0) this.waiting.push(item)
    else this.waiting.splice(before, 0, item)
  }
  private acquire(signal: AbortSignal, priority: boolean): Promise<() => void> {
    if (this.closed || signal.aborted)
      return Promise.reject(new RecapError('CANCELLED', 'Request cancelled.', 409))
    if (this.waiting.length >= 1000)
      return Promise.reject(new RecapError('QUEUE_FULL', 'Generation queue is full.', 429))
    return new Promise((resolve, reject) => {
      const item: Waiting = {
        signal,
        priority,
        resolve,
        reject,
        abort: () => {
          const index = this.waiting.indexOf(item)
          if (index >= 0) this.waiting.splice(index, 1)
          reject(abortReason(signal))
        },
      }
      signal.addEventListener('abort', item.abort, { once: true })
      const before = priority ? this.waiting.findIndex((w) => !w.priority) : -1
      if (before < 0) this.waiting.push(item)
      else this.waiting.splice(before, 0, item)
      this.drain()
    })
  }
  drain(): void {
    while (!this.closed && this.active < this.limit() && this.waiting.length > 0) {
      const item = this.waiting.shift()
      if (!item) break
      item.signal.removeEventListener('abort', item.abort)
      if (item.signal.aborted) {
        item.reject(abortReason(item.signal))
        continue
      }
      this.active++
      let released = false
      item.resolve(() => {
        if (!released) {
          released = true
          this.active--
          this.drain()
        }
      })
    }
  }
  close(): void {
    this.closed = true
    for (const item of this.waiting.splice(0)) {
      item.signal.removeEventListener('abort', item.abort)
      item.reject(new RecapError('CANCELLED', 'Plugin unloaded.', 409))
    }
  }
}
