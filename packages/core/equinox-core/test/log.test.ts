import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { AppendLog } from '@solsticeai/core'

const dirs: string[] = []

function tempLog(): string {
  const dir = mkdtempSync(join(tmpdir(), 'equinox-log-'))
  dirs.push(dir)
  return join(dir, 'session.jsonl')
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('AppendLog', () => {
  it('appends hash-chained events with increasing seq', () => {
    const file = tempLog()
    const log = new AppendLog(file)
    const a = log.append('message', { text: 'hello' })
    const b = log.append('tool_call', { name: 'view_file' })
    expect(a.seq).toBe(1)
    expect(b.seq).toBe(2)
    expect(a.prevHash).toBe('EQUINOX_GENESIS')
    expect(b.prevHash).toBe(a.hash)
    expect(a.hash).not.toBe(b.hash)
  })

  it('round-trips events through readAll', () => {
    const file = tempLog()
    const log = new AppendLog(file)
    log.append('message', { text: 'hi' })
    log.append('final', { text: 'done' })
    const events = log.readAll()
    expect(events).toHaveLength(2)
    expect(events[0]!.type).toBe('message')
    expect(events[1]!.payload).toEqual({ text: 'done' })
  })

  it('verifies an intact chain', () => {
    const file = tempLog()
    const log = new AppendLog(file)
    log.append('a')
    log.append('b')
    expect(log.verify()).toEqual({ valid: true, brokenAt: -1 })
  })

  it('detects tampering (hash mismatch)', () => {
    const file = tempLog()
    const log = new AppendLog(file)
    log.append('a', { x: 1 })
    log.append('b', { x: 2 })
    // Tamper: rewrite the first event's payload while keeping its old hash.
    const a = log.readAll()[0]!
    writeFileSync(file, JSON.stringify({ ...a, payload: { x: 999 } }) + '\n')
    expect(log.verify().valid).toBe(false)
  })

  it('returns empty for missing file', () => {
    const log = new AppendLog(join(tmpdir(), 'nope', 'does-not-exist.jsonl'))
    expect(log.exists()).toBe(false)
    expect(log.readAll()).toEqual([])
    expect(log.tail()).toBeUndefined()
  })
})