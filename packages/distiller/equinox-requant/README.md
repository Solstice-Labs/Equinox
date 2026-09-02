# @solsticeai/equinox-requant

Asymmetric re-quant engine for Project Equinox: compiles the profiler's
𝓘ₗ-based `QuantPlan` into real llama.cpp invocations for per-layer mixed
precision.

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