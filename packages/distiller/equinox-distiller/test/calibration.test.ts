import { describe, expect, it } from 'vitest'

import { compileCalibrationPool, serializePool, shareGptToMessages } from '@solsticeai/distiller'

function anchors(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    conversations: [
      { from: 'human', value: `anchor question ${i}` },
      { from: 'gpt', value: `anchor answer ${i}` },
    ],
  }))
}

function recoveries(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    prompt: `recovery prompt ${i}`,
    resolution: `1. step a\n2. step b — resolved ${i}`,
  }))
}

describe('shareGptToMessages', () => {
  it('converts human/gpt pairs to user/assistant messages', () => {
    const messages = shareGptToMessages(anchors(1)[0]!)
    expect(messages).toEqual([
      { role: 'user', content: 'anchor question 0' },
      { role: 'assistant', content: 'anchor answer 0' },
    ])
  })
  it('returns null when there is no user turn', () => {
    expect(shareGptToMessages({ conversations: [{ from: 'gpt', value: 'x' }] })).toBeNull()
  })
})

describe('compileCalibrationPool', () => {
  it('builds a 30/70 mixed pool deterministically', () => {
    const a = compileCalibrationPool({
      anchors: anchors(80),
      recoveries: recoveries(160),
      poolSize: 100,
      seed: 7,
    })
    expect(a.entries.length).toBe(100)
    // ratio is enforced toward 30% anchors / 70% recoveries
    expect(a.stats.anchorRatio).toBeCloseTo(0.3, 0)
    expect(Math.abs(a.stats.anchorCount - 30)).toBeLessThanOrEqual(1)
    expect(Math.abs(a.stats.recoveryCount - 70)).toBeLessThanOrEqual(1)
    // deterministic — same seed, same pool
    const b = compileCalibrationPool({
      anchors: anchors(80),
      recoveries: recoveries(160),
      poolSize: 100,
      seed: 7,
    })
    expect(a.entries.map((e) => e.sha)).toEqual(b.entries.map((e) => e.sha))
  })

  it('deduplicates identical prompts', () => {
    const dup = compileCalibrationPool({
      anchors: [anchors(1)[0]!, anchors(1)[0]!],
      recoveries: [],
      poolSize: 10,
      seed: 1,
    })
    const shas = new Set(dup.entries.map((e) => e.sha))
    expect(shas.size).toBe(dup.entries.length)
    expect(dup.stats.deduped).toBeGreaterThan(0)
  })

  it('serializes to ShareGPT JSONL', () => {
    const pool = compileCalibrationPool({ anchors: anchors(3), recoveries: recoveries(3), poolSize: 6, seed: 3 })
    const lines = serializePool(pool.entries).split('\n').filter(Boolean)
    expect(lines).toHaveLength(pool.entries.length)
    for (const line of lines) {
      const parsed = JSON.parse(line) as { conversations?: unknown[] }
      expect(Array.isArray(parsed.conversations)).toBe(true)
    }
  })
})