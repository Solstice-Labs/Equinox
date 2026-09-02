import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { DistillationTraces } from '@solsticeai/distiller'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function tempTraces(): DistillationTraces {
  const dir = mkdtempSync(join(tmpdir(), 'equinox-traces-'))
  dirs.push(dir)
  return new DistillationTraces(join(dir, 'distillation_traces.jsonl'))
}

describe('DistillationTraces', () => {
  it('appends DPO triples and reads them back', () => {
    const traces = tempTraces()
    traces.append('fix the bug', [{ step: 1, tool: 'view_file' }], [{ step: 1, tool: 'edit_file' }], {
      model: 'm',
      teacher: 'claude',
      failedSteps: 1,
      verifiedSteps: 1,
      verified: true,
    })
    expect(traces.count).toBe(1)
    const triple = traces.triples[0]!
    expect(triple.prompt).toBe('fix the bug')
    expect(triple.failedTrace[0]).toMatchObject({ tool: 'view_file' })
    expect(triple.meta['verified']).toBe(true)
  })

  it('keeps the hash chain intact across appends', () => {
    const traces = tempTraces()
    traces.append('a', [], [], { model: 'm', teacher: 'gemini', failedSteps: 0, verifiedSteps: 0, verified: true })
    traces.append('b', [], [], { model: 'm', teacher: 'gemini', failedSteps: 0, verifiedSteps: 0, verified: true })
    expect(traces.verify()).toEqual({ valid: true, brokenAt: -1 })
  })
})