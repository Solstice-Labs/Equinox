/**
 * Exact per-layer activation capture via HuggingFace transformers.
 *
 * This backend runs a standalone Python script (rendered at runtime, no asset
 * pipeline) that streams hidden states through forward hooks, accumulating
 * streaming moments (n, Σx, Σx², Σx⁴) per layer per hidden dimension — O(D)
 * memory — and then writes per-layer variance, kurtosis, and composite
 * importance to a JSON file. Designed to be dispatched to a Lightning GPU
 * studio via the bridge, but runs anywhere torch + transformers exist.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { CaptureBackend, LayerMoments } from '@solsticeai/core'

export interface HiddenStatesOptions {
  model: string
  corpusPath: string
  outPath: string
  maxLen?: number
  maxSamples?: number
  device?: string
  dtype?: string
}

export function renderHiddenStatesScript(options: HiddenStatesOptions): string {
  const maxLen = options.maxLen ?? 512
  const maxSamples = options.maxSamples ?? 64
  const device = options.device ?? 'cuda'
  const dtype = options.dtype ?? 'bfloat16'
  return `#!/usr/bin/env python3
"""Equinox hidden-states activation capture (generated). Usage: python3 capture.py"""
import json, sys
import torch
from transformers import AutoModel, AutoTokenizer

MODEL = ${JSON.stringify(options.model)}
CORPUS = ${JSON.stringify(options.corpusPath)}
OUT = ${JSON.stringify(options.outPath)}
MAX_LEN = ${maxLen}
MAX_SAMPLES = ${maxSamples}
DEVICE = ${JSON.stringify(device)}
DTYPE = ${JSON.stringify(dtype)}

def main():
    tok = AutoTokenizer.from_pretrained(MODEL)
    model = AutoModel.from_pretrained(MODEL, torch_dtype=getattr(torch, DTYPE), output_hidden_states=True)
    model = model.to(DEVICE)
    model.eval()

    probe = tok(["hello"], return_tensors="pt", padding=True, truncation=True, max_length=16).to(DEVICE)
    with torch.no_grad():
        outs = model(**probe)
    n_layers = len(outs.hidden_states) - 1
    hidden_size = outs.hidden_states[-1].shape[-1]
    print(f"detected {n_layers} layers x {hidden_size} dims", file=sys.stderr)

    z = lambda: torch.zeros(hidden_size, dtype=torch.float64)
    # per layer: [sum1, sum2, sum3, sum4] streaming moments (O(D) memory)
    acc = [[z(), z(), z(), z()] for _ in range(n_layers)]
    counts = [0] * n_layers

    with torch.no_grad():
        for i, line in enumerate(open(CORPUS, encoding="utf-8")):
            if i >= MAX_SAMPLES:
                break
            line = line.strip()
            if len(line) < 8:
                continue
            enc = tok(line, return_tensors="pt", padding=True, truncation=True, max_length=MAX_LEN).to(DEVICE)
            ids = enc["input_ids"]
            if ids.shape[1] < 2:
                continue
            outs = model(**enc)
            mask = enc["attention_mask"].bool()
            for l in range(n_layers):
                h = outs.hidden_states[l + 1][mask].to(torch.float64)  # (tokens, dim)
                counts[l] += int(h.shape[0])
                acc[l][0] += h.sum(dim=0)
                acc[l][1] += (h * h).sum(dim=0)
                acc[l][2] += (h * h * h).sum(dim=0)
                acc[l][3] += (h * h * h * h).sum(dim=0)

        layers = []
        for l in range(n_layers):
            n = max(counts[l], 1)
            s1, s2, s3, s4 = acc[l]
            mu = s1 / n
            var = torch.clamp(s2 / n - mu * mu, min=1e-12)
            m4 = (s4 / n) - 4 * mu * (s3 / n) + 6 * (mu * mu) * (s2 / n) - 3 * (mu ** 4)
            kurt = torch.clamp(m4 / (var * var), min=0.0)
            impt = torch.mean(var * torch.log(1 + kurt))
            layers.append({
                "layer": l,
                "variance": float(var.mean().item()),
                "kurtosis": float(kurt.mean().item()),
                "importance": float(impt.item()),
                "samples": int(n),
            })
    out = {"model": MODEL, "backend": "hidden-states", "layers": layers}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print("wrote " + OUT)

if __name__ == "__main__":
    main()
`
}

export interface HiddenStatesResult {
  model: string
  backend: CaptureBackend
  layers: LayerMoments[]
}

/** Parse the JSON emitted by the rendered script. Tolerates missing fields. */
export function parseHiddenStatesResult(json: string): HiddenStatesResult {
  const raw = JSON.parse(json) as { model?: string; layers?: unknown }
  const layers = Array.isArray(raw.layers)
    ? (raw.layers as Partial<LayerMoments>[]).map((l, i) => ({
        layer: typeof l.layer === 'number' ? l.layer : i,
        variance: typeof l.variance === 'number' ? l.variance : 0,
        kurtosis: typeof l.kurtosis === 'number' ? l.kurtosis : 3,
        importance: typeof l.importance === 'number' ? l.importance : 0,
        samples: typeof l.samples === 'number' ? l.samples : 0,
      }))
    : []
  return { model: raw.model ?? 'unknown', backend: 'hidden-states', layers }
}

/** Write the rendered script to disk (for dispatch or local exec). */
export function writeCaptureScript(options: HiddenStatesOptions, scriptDir: string): string {
  mkdirSync(scriptDir, { recursive: true })
  const scriptPath = join(scriptDir, 'capture_hidden_states.py')
  writeFileSync(scriptPath, renderHiddenStatesScript(options), 'utf8')
  return scriptPath
}

/** Convenience path helper. */
export function defaultCorpusPath(home: string): string {
  return join(home, 'capture', 'probe_corpus.txt')
}

/** Write the probe-derived corpus to disk. */
export function writeCorpus(home: string, corpus: string): string {
  const dir = join(home, 'capture')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'probe_corpus.txt')
  writeFileSync(file, corpus, 'utf8')
  return file
}