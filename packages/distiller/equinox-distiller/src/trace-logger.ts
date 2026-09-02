/**
 * Records DPO triples (prompt, failed_trace, verified_trace) to
 * `.equinox/distillation_traces.jsonl` as a hash-chained append-only log.
 */

import { join } from 'node:path'

import type { DpoTriple, LogEvent } from '@solsticeai/core'
import { AppendLog } from '@solsticeai/core'

export interface TraceMeta {
  model: string
  teacher: string
  failedSteps: number
  verifiedSteps: number
  verified: boolean
  ts: string
}

export class DistillationTraces {
  private readonly log: AppendLog

  constructor(file = join('.equinox', 'distillation_traces.jsonl')) {
    this.log = new AppendLog(file)
  }

  append(
    prompt: string,
    failedTrace: unknown[],
    verifiedTrace: unknown[],
    meta: Omit<TraceMeta, 'ts'>,
  ): LogEvent {
    const triple: DpoTriple = { prompt, failedTrace, verifiedTrace, meta: { ...meta, ts: new Date().toISOString() } }
    return this.log.append('dpo_triple', triple)
  }

  readAll(): LogEvent[] {
    return this.log.readAll()
  }

  get triples(): DpoTriple[] {
    return this.log
      .readAll()
      .filter((e) => e.type === 'dpo_triple')
      .map((e) => e.payload as DpoTriple)
  }

  get count(): number {
    return this.triples.length
  }

  verify(): { valid: boolean; brokenAt: number } {
    return this.log.verify()
  }
}