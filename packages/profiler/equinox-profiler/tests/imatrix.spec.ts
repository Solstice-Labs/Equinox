import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { buildImatrixCorpus, imatrixToLayerStats, loadImatrixCapture, parseImatrixDat, tensorLayer } from '../src/index.ts'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** Build a synthetic .dat buffer matching llama-imatrix's on-disk format. */
/** layout: [i32 nameLen][name][i32 ncall][i32 nvec][f32 values...] */
function synthesizeDat(tensors: [string, number, number[]][]): Buffer {
  const chunks: Buffer[] = []
  for (const [name, ncall, values] of tensors) {
    const nameBuf = Buffer.from(name, 'utf8')
    const header = Buffer.alloc(12 + nameBuf.length)
    header.writeInt32LE(nameBuf.length, 0)
    nameBuf.copy(header, 4)
    header.writeInt32LE(ncall, 4 + nameBuf.length)
    header.writeInt32LE(values.length, 8 + nameBuf.length)
    chunks.push(header, Buffer.from(new Float32Array(values).buffer))
  }
  return Buffer.concat(chunks)
}

describe('parseImatrixDat', () => {
  it('parses records with name, ncall, nvec, values', () => {
    const dat = synthesizeDat([
      ['blk.0.attn_q.weight', 100, [100, 200, 300]],
      ['blk.0.ffn_up.weight', 100, [400]],
      ['token_embd.weight', 50, [10, 20]],
    ])
    const records = parseImatrixDat(dat)
    expect(records).toHaveLength(3)
    expect(records[0]).toMatchObject({ name: 'blk.0.attn_q.weight', ncall: 100, nvec: 3 })
    expect([...records[0]!.values]).toEqual([100, 200, 300])
    expect(records[2]!.name).toBe('token_embd.weight')
  })

  it('tolerates zero-length values', () => {
    const dat = synthesizeDat([['blk.0.attn_v.weight', 10, []]])
    const records = parseImatrixDat(dat)
    expect(records[0]!.nvec).toBe(0)
  })

  it('throws on truncated data', () => {
    const dat = synthesizeDat([['blk.0.attn_q.weight', 2, [1, 2, 3]]])
    expect(() => parseImatrixDat(dat.subarray(0, dat.length - 4))).toThrow(/malformed|truncated/)
  })

  it('derives layer indices from tensor names', () => {
    expect(tensorLayer('blk.12.attn_q.weight')).toBe(12)
    expect(tensorLayer('token_embd.weight')).toBe(-1)
  })
})

describe('imatrixToLayerStats', () => {
  it('reduces tensors to per-layer variance proxies (κ = 3 prior)', () => {
    const dat = synthesizeDat([
      ['blk.0.attn_q.weight', 100, [100, 300]],
      ['blk.0.ffn_up.weight', 100, [200]],
      ['blk.1.attn_q.weight', 100, [500]],
    ])
    const stats = imatrixToLayerStats(parseImatrixDat(dat))
    expect(stats).toHaveLength(2)
    // layer 0: mean E[x²] = ((1+3)/2 + 2)/2 = 2 → importance = 2·log4
    expect(stats[0]).toMatchObject({ layer: 0, kurtosis: 3 })
    expect(stats[0]!.variance).toBeCloseTo(2, 6)
    expect(stats[0]!.importance).toBeCloseTo(2 * Math.log(4), 6)
    expect(stats[1]!.variance).toBeCloseTo(5, 6)
  })

  it('skips non-layer tensors', () => {
    const dat = synthesizeDat([['token_embd.weight', 5, [1, 2]]])
    expect(imatrixToLayerStats(parseImatrixDat(dat))).toEqual([])
  })
})

describe('loadImatrixCapture', () => {
  it('loads a .dat file from disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'equinox-imatrix-'))
    dirs.push(dir)
    const file = join(dir, 'test.dat')
    writeFileSync(file, synthesizeDat([['blk.0.attn_q.weight', 10, [10, 20]]]))
    const capture = loadImatrixCapture({ datFile: file })
    expect(capture.backend).toBe('imatrix-proxy')
    expect(capture.stats).toHaveLength(1)
    expect(capture.tensors[0]).toMatchObject({ tensor: 'blk.0.attn_q.weight', layer: 0 })
  })
})

describe('buildImatrixCorpus', () => {
  it('deduplicates messages, keeps order, skips assistant role', () => {
    const probes = [
      { messages: [{ role: 'system', content: 'sys a' }, { role: 'user', content: 'user 1' }, { role: 'assistant', content: 'skip me' }] },
      { messages: [{ role: 'user', content: 'user 1' }] },
    ]
    const corpus = buildImatrixCorpus(probes)
    expect(corpus).toBe('sys a\n\nuser 1')
  })
})
