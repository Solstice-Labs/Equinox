/**
 * llama-imatrix `.dat` capture backend.
 *
 * The `.dat` format written by `llama-imatrix` is a sequence of records:
 *   [int32 nameLength][name bytes][int32 ncall][int32 nvec][float values[nvec]]
 * where `values` accumulates per-column sums of squared activations over
 * `ncall` tokens. This gives universal *second-moment* statistics for any
 * GGUF model — no GPU or torch required, only the llama.cpp binary.
 *
 * Exact variance/kurtosis (4th moments) require the hidden-states backend;
 * here kurtosis is taken as the Gaussian prior (κ = 3).
 */

import { readFileSync } from 'node:fs'

import type { CaptureBackend, LayerMoments, TensorProxy } from '@solsticeai/core'
import { mean } from '@solsticeai/core'

export interface ImatrixRecord {
  name: string
  ncall: number
  nvec: number
  values: Float32Array
}

/** Parse a raw llama-imatrix `.dat` buffer into per-tensor records. */
export function parseImatrixDat(buffer: Buffer | Uint8Array): ImatrixRecord[] {
  const bytes = buffer instanceof Buffer ? buffer : Buffer.from(buffer)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out: ImatrixRecord[] = []
  let offset = 0
  while (offset < bytes.length) {
    if (offset + 4 > bytes.length) throw new Error(`imatrix .dat truncated at name-length (offset ${offset})`)
    const nameLen = view.getInt32(offset, true)
    offset += 4
    if (nameLen <= 0 || nameLen > 4096 || offset + nameLen > bytes.length) {
      throw new Error(`imatrix .dat malformed name length ${nameLen} at offset ${offset - 4}`)
    }
    const name = bytes.subarray(offset, offset + nameLen).toString('utf8')
    offset += nameLen
    if (offset + 8 > bytes.length) throw new Error(`imatrix .dat truncated at stats header`)
    const ncall = view.getInt32(offset, true)
    const nvec = view.getInt32(offset + 4, true)
    offset += 8
    if (nvec < 0 || nvec > 1_000_000_000 || offset + nvec * 4 > bytes.length) {
      throw new Error(`imatrix .dat malformed nvec ${nvec} for tensor ${name}`)
    }
    const values = new Float32Array(nvec)
    for (let i = 0; i < nvec; i++) {
      values[i] = view.getFloat32(offset, true)
      offset += 4
    }
    out.push({ name, ncall, nvec, values })
  }
  return out
}

const LAYER_RE = /(?:^|\.)blk\.(\d+)\./

/** Layer index for a tensor name: `blk.N....` → N; others → -1. */
export function tensorLayer(name: string): number {
  const m = LAYER_RE.exec(name)
  return m ? Number.parseInt(m[1] as string, 10) : -1
}

/** Reduce per-tensor records into per-layer second-moment proxies. */
export function imatrixToLayerStats(records: ImatrixRecord[]): LayerMoments[] {
  const layers = new Map<number, number[]>()
  for (const rec of records) {
    const layer = tensorLayer(rec.name)
    if (layer < 0) continue // embeddings / output head — skip for layer stats
    const denom = Math.max(1, rec.ncall)
    let sum = 0
    for (let i = 0; i < rec.values.length; i++) {
      sum += (rec.values[i] as number) / denom
    }
    const meanSq = rec.values.length > 0 ? sum / rec.values.length : 0
    const list = layers.get(layer) ?? []
    list.push(meanSq)
    layers.set(layer, list)
  }
  const stats: LayerMoments[] = []
  for (const [layer, tensorMeans] of [...layers.entries()].sort((a, b) => a[0] - b[0])) {
    const variance = mean(tensorMeans)
    stats.push({
      layer,
      variance,
      kurtosis: 3, // Gaussian prior — imatrix has no 4th moments
      importance: variance * Math.log(4),
      samples: tensorMeans.length,
    })
  }
  return stats
}

export interface ImatrixCaptureResult {
  backend: CaptureBackend
  stats: LayerMoments[]
  tensors: TensorProxy[]
  datFile: string
}

export interface ImatrixOptions {
  datFile: string
}

/** Load a .dat from disk and produce layer statistics. */
export function loadImatrixCapture(options: ImatrixOptions): ImatrixCaptureResult {
  const raw = readFileSync(options.datFile)
  const records = parseImatrixDat(raw)
  const layers = imatrixToLayerStats(records)
  const tensors: TensorProxy[] = records.map((r) => ({
    tensor: r.name,
    layer: tensorLayer(r.name),
    meanSq: r.values.length > 0 ? mean([...(r.values as unknown as number[])]) / Math.max(1, r.ncall) : 0,
    columns: r.nvec,
  }))
  return { backend: 'imatrix-proxy', stats: layers, tensors, datFile: options.datFile }
}

/** Build a plain-text corpus from probe prompts for `llama-imatrix -f`. */
export function buildImatrixCorpus(probes: { messages: { role: string; content: string }[] }[]): string {
  const chunks: string[] = []
  for (const probe of probes) {
    for (const msg of probe.messages) {
      if (msg.role === 'system' || msg.role === 'user') chunks.push(msg.content)
    }
  }
  // Deduplicate while preserving order; cap total size to 2 MiB.
  const seen = new Set<string>()
  const unique: string[] = []
  let bytes = 0
  for (const c of chunks) {
    if (seen.has(c)) continue
    seen.add(c)
    unique.push(c)
    bytes += c.length
    if (bytes > 2 * 1024 * 1024) break
  }
  return unique.join('\n\n')
}