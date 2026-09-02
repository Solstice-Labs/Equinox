# @solsticeai/equinox-profiler

Deterministic 50-probe diagnostic engine and activation fingerprint builder for
Project Equinox — the tensor plane of the DeepSeek Harness fork.

## What it does

- **50 deterministic probes** across five domains (10 each): strict JSON
  syntax, coding transforms graded by acorn AST analysis, symbolic constraint
  solving, 3-turn stateful tool flows against an in-memory sandbox, and
  negative-constraint / format-invariant instruction following.
- **Zero judge-model grading**: every validator is a pure offline heuristic
  (regex + AST + constraint solvers) — no second-model cost.
- **Activation fingerprinting** — the dual-plane math (σ², κ, 𝓘ₗ) — with two
  capture backends selected per environment:
  - `imatrix-proxy`: parses `llama-imatrix` `.dat` second moments locally —
    works for **any** model llama.cpp can sample, no GPU needed.
  - `hidden-states`: renders an exact 4th-moment capture script
    (`output_hidden_states` forward passes) for GPU / offload runs.
- **Model profile output**: probe composite + domain scores fused with layer
  stats into a `model-profile.json` shape carrying a normalized asymmetric
  precision plan (0.85 / 0.35 tiers) consumed by `@solsticeai/equinox-requant`.

The core modules (probes, graders, math, fingerprint, capture) are pure and
carry no Cordis dependency; the package entry is a thin `ctx.profiler` service.

## Usage

```ts
import { Context } from '@solsticeai/cordis'
import Profiler from '@solsticeai/equinox-profiler'

const ctx = new Context()
await ctx.plugin(Profiler)

const suite = await ctx.profiler.runSuite({
  client: myModelClient, // anything satisfying ModelClient
})
const profile = ctx.profiler.fingerprint({
  model: 'my-model',
  backend: 'imatrix-proxy',
  domainScores: suite.domainScores,
  probeComposite: suite.composite,
  layerStats: captureStats,
})
```

`EQUINOX_*` (falling back to `DSH_*`) environment variables configure capture
paths; see the lightning bridge package for offload orchestration.