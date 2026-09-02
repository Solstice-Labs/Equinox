---
description: "Asymmetric re-quant engine for Project Equinox — compiles the profiler's 𝓘ₗ-based QuantPlan into real llama.cpp invocations for per-layer mixed precision, locally or offloaded to a Lightning Studio GPU."
kind: "package-reference"
---

# @solsticeai/equinox-requant

Asymmetric re-quant engine for Project Equinox: compiles the profiler's
𝓘ₗ-based `QuantPlan` into real llama.cpp invocations for per-layer mixed
precision.

## Summary

`equinox-requant` turns a `ModelProfile` from `@solsticeai/equinox-profiler`
into real llama.cpp work: it ensures an importance matrix exists (`IQ2_XXS`
tiers require one), compiles the profile's tier mapping into
`--tensor-type` rules (𝓘ₗ > 0.85 → FP16/Q8_0, mid → Q4_K_M, ≤ 0.35 →
IQ2_XXS), runs `llama-quantize` locally or offloaded to a Lightning Studio,
and writes a reproducible `model-out.gguf.manifest.json`. Plans that are not
weight-grounded (API-fingerprinted models with no local twin) are refused
unless `allowEstimated: true` is passed explicitly.

## Table of Contents

- [What it does](#what-it-does)
- [Usage](#usage)
- [Dev Note](#dev-note)

## What it does

1. Ensures an importance matrix exists — computing one with `llama-imatrix`
   when a profile selects IQ2_XXS tiers (which **require** an imatrix).
2. Runs `llama-quantize` with `--tensor-type "blk\\.(N)\\.attn_.*=q8_0"` style
   rules compiled from the profile's tier mapping (𝓘ₗ > 0.85 → FP16/Q8_0,
   mid → Q4_K_M base, ≤ 0.35 → IQ2_XXS), plus
   `--token-embedding-type` / `--output-tensor-type`.
3. Executes locally when resources suffice, or dispatches to a Lightning
   Studio via `@solsticeai/equinox-lightning` (with artifact pull-back).
4. Writes `model-out.gguf.manifest.json` capturing both commands, sizes, and
   execution status for reproducible pipelines.

## Usage

```ts
import Profiler, { buildFingerprint } from '@solsticeai/equinox-profiler'
import { runRequant } from '@solsticeai/equinox-requant'

const manifest = await runRequant({
  profile,       // ModelProfile from the profiler fingerprint
  modelIn: 'model.gguf',
  modelOut: 'model.asymmetric.gguf',
  corpus: 'probe_corpus.txt',   // triggers imatrix if IQ2_XXS selected
  bundleDir: '.',
})
```

A dry run (`EQUINOX_DRY_RUN=1`) previews the exact imatrix/quantize commands
without dispatching.

## Dev Note

The quant rules are compiled directly from the profile's `tensorPlan`, never
re-derived from probe scores at run time — keep the manifest diff-able and the
pipeline reproducible by treating the profile as the single source of truth
for precision tiers.