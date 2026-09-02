import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { findQuantizeBin, quantTierSummary, runRequant } from '../src/index.ts'
import { EquinoxBridge, loadConfig, type ExecResult, type QuantPlan } from '../../../cloud/equinox-lightning/src/index.ts'
import type { ModelProfile } from '../../../profiler/equinox-profiler/src/index.ts'

/** This box has no GPU, so inject fake resources that keep execution local. */
function localBridge() {
  return new EquinoxBridge(loadConfig({}), {
    resources: { cpus: 16, memBytes: 64 * 1e9, hasGpu: true },
  })
}

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function plan(): QuantPlan {
  return {
    baseType: 'Q4_K_M',
    tokenEmbeddingType: 'q4_k',
    outputTensorType: 'q8_0',
    rules: [
      { tier: 'iq2_xxs', layers: [0, 1] },
      { tier: 'q4_k_m', layers: [2, 3] },
      { tier: 'q8_0', layers: [4] },
    ],
  }
}

function profile(): ModelProfile {
  return {
    schemaVersion: 1,
    model: 'test-model',
    backend: 'imatrix-proxy',
    generatedAt: new Date().toISOString(),
    probeComposite: 0.6,
    domainScores: {},
    layerStats: [],
    quantPlan: plan(),
    policy: { scratchpad: 'off', drift: 0, temperature: { code: 0.1, reasoning: 0.6, default: 0.4 } },
  }
}

describe('quantTierSummary', () => {
  it('summarizes rules', () => {
    expect(quantTierSummary(plan())).toContain('iq2_xxs(2 layers)')
    expect(quantTierSummary({ ...plan(), rules: [] })).toContain('uniform')
  })
})

describe('findQuantizeBin', () => {
  it('falls back to the standard binary name', () => {
    expect(findQuantizeBin(loadConfig({}))).toBe('llama-quantize')
  })
})

describe('runRequant', () => {
  it('refuses when iq2_xxs literals need an imatrix but none can be computed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'equinox-quant-'))
    dirs.push(dir)
    const modelIn = join(dir, 'model.gguf')
    writeFileSync(modelIn, 'GGUF-DATA')
    const manifest = await runRequant({
      profile: profile(),
      modelIn,
      modelOut: join(dir, 'model-q.gguf'),
      config: loadConfig({}),
    })
    expect(manifest.executed).toBe(false)
    expect(manifest.note).toMatch(/imatrix required/)
  })

  it('runs quantize locally through the executor when an imatrix is provided', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'equinox-quant-'))
    dirs.push(dir)
    const modelIn = join(dir, 'model.gguf')
    const modelOut = join(dir, 'model-q.gguf')
    writeFileSync(modelIn, 'GGUF-DATA')
    // Simulate the quantizer producing an output file.
    const executor = {
      run: async (argv: string[]): Promise<ExecResult> => {
        expect(argv[0]).toBe('llama-quantize')
        expect(argv).toContain('--imatrix')
        expect(argv).toContain('--tensor-type')
        // produce the output like a real quantizer would (paths are absolute)
        writeFileSync(argv.slice(-2, -1)[0] as string, 'QUANTIZED')
        return { ok: true, stdout: 'done', stderr: '', code: 0 }
      },
    }
    const manifest = await runRequant({
      profile: profile(),
      modelIn,
      modelOut,
      imatrixDat: join(dir, 'm.dat'),
      config: loadConfig({}),
      bridge: localBridge(),
      executor,
    })
    expect(manifest.executed).toBe(true)
    expect(manifest.outSizeBytes).toBeGreaterThan(0)
    expect(manifest.quantizeCmd[0]).toBe('llama-quantize')
    const manifestFile = JSON.parse(readFileSync(`${modelOut}.manifest.json`, 'utf8')) as { model?: string }
    expect(manifestFile.model).toBe('test-model')
  })

  it('computes an imatrix first when the plan needs one and a corpus is given', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'equinox-quant-'))
    dirs.push(dir)
    const modelIn = join(dir, 'model.gguf')
    const corpus = join(dir, 'corpus.txt')
    const modelOut = join(dir, 'out.gguf')
    writeFileSync(modelIn, 'GGUF')
    writeFileSync(corpus, 'probe text here')
    const calls: string[][] = []
    const executor = {
      run: async (argv: string[]): Promise<ExecResult> => {
        calls.push(argv)
        const outIdx = argv.indexOf('-o')
        const target = outIdx >= 0 ? argv[outIdx + 1] : (argv.slice(-2, -1)[0] as string)
        if (argv[0] === 'llama-imatrix') {
          writeFileSync(target as string, 'imatrix-bytes')
          return { ok: true, stdout: '', stderr: '', code: 0 }
        }
        writeFileSync(target as string, 'QUANTIZED')
        return { ok: true, stdout: '', stderr: '', code: 0 }
      },
    }
    const manifest = await runRequant({
      profile: profile(),
      modelIn,
      modelOut,
      corpus,
      config: loadConfig({}),
      bridge: localBridge(),
      executor,
    })
    expect(calls.some(c => c[0] === 'llama-imatrix')).toBe(true)
    expect(calls.some(c => c[0] === 'llama-quantize')).toBe(true)
    expect(manifest.executed).toBe(true)
    expect(manifest.imatrix).toBeTruthy()
  })
})
