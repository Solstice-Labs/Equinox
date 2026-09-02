/**
 * Append-only, tamper-evident JSONL event log used for trajectory logging
 * and DPO trace recording. Every event is hash-chained to its predecessor.
 */

import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

import type { LogEvent } from './types.js'

const GENESIS = 'EQUINOX_GENESIS'

export class AppendLog {
  constructor(private readonly file: string) {
    mkdirSync(dirname(file), { recursive: true })
  }

  append(type: string, payload: unknown = {}): LogEvent {
    const prev = this.tail()
    const seq = prev ? prev.seq + 1 : 1
    const prevHash = prev ? prev.hash : GENESIS
    const body = {
      seq,
      ts: new Date().toISOString(),
      type,
      payload,
      prevHash,
    }
    const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex')
    const event = { ...body, hash } as LogEvent
    appendFileSync(this.file, JSON.stringify(event) + '\n')
    return event
  }

  exists(): boolean {
    return existsSync(this.file)
  }

  readAll(): LogEvent[] {
    if (!this.exists()) return []
    const lines = readFileSync(this.file, 'utf8').split('\n').filter((l) => l.length > 0)
    return lines.map((l) => JSON.parse(l) as LogEvent)
  }

  tail(): LogEvent | undefined {
    const events = this.readAll()
    return events.length > 0 ? events[events.length - 1] : undefined
  }

  /** Verify the hash chain is intact. Returns the broken event index, or -1. */
  verify(): { valid: boolean; brokenAt: number } {
    const events = this.readAll()
    let prevHash = GENESIS
    for (let i = 0; i < events.length; i++) {
      const e = events[i] as LogEvent
      const body = JSON.stringify({ seq: e.seq, ts: e.ts, type: e.type, payload: e.payload, prevHash })
      const recomputed = createHash('sha256').update(body).digest('hex')
      if (e.prevHash !== prevHash || e.hash !== recomputed) {
        return { valid: false, brokenAt: i }
      }
      prevHash = e.hash
    }
    return { valid: true, brokenAt: -1 }
  }
}