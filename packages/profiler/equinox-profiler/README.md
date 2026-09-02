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
- **Online (API-hosted) fingerprinting** — backend `api` profiles models you
  don't hold weights for, as closely as a black-box endpoint allows:
  - ships an **OpenAI-compatible client** (`OpenAIClient`, logprobs + retry /
    backoff, `EQUINOX_*` → `DSH_*` env) usable against any chat-completions
    endpoint (OpenAI, DeepSeek, OpenRouter, hosted vLLM / SGLang, …);
  - sweeps probe verdicts at high temperature to measure **consistency** —
    verdict flip-flops are the black-box analogue of activation variance;
  - reads per-token **logprobs** where exposed for response entropy / model
    commitment, plus **calibration** and prompt-perturbation **robustness**;
  - when a local **twin** (same family, ±10 % params) has been profiled with
    real weights, its per-layer plan transfers with behavioral-health
    confidence — otherwise the plan is uniform and marked `tensorGrounded:
    false`, and `@solsticeai/equinox-requant` refuses to apply it unless
    explicitly allowed.
- **Model profile output**: probe composite + domain scores fused with layer
  stats into a `model-profile.json` shape carrying a normalized asymmetric
  precision plan (0.85 / 0.35 tiers) consumed by `@solsticeai/equinox-requant`.

The core modules (probes, graders, math, fingerprint, capture, client) are
pure and carry no Cordis dependency; the package entry is a thin
`ctx.profiler` service.

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

Profiling a model served only through an API (no local weights):

```ts
import { OpenAIClient, runApiFingerprint, buildFingerprint } from '@solsticeai/equinox-profiler'

const client = new OpenAIClient({ model: 'deepseek-chat' }) // env: EQUINOX_API_KEY / EQUINOX_API_BASE_URL
const suite = await ctx.profiler.runSuite({ client })
const api = await runApiFingerprint({
  model: 'deepseek-chat',
  baseSuite: suite,
  sampler: (messages, options) => client.sample(messages, options),
  logprobs: true,
})
const profile = buildFingerprint({
  model: 'deepseek-chat',
  backend: 'api',
  domainScores: suite.domainScores,
  probeComposite: suite.composite,
  layerStats: [],
  api,
  twins: [locallyProfiledTwin], // optional — grounds the tensor forecast
})
```

The profile's `policy` (scratchpad mode, code vs reasoning temperature) is
driven by behavioral stability and calibration for API models, exactly as it
is driven by layer drift for local weights; `tensorGrounded` distinguishes a
twin-grounded quant plan from an honest estimate.

`EQUINOX_*` (falling back to `DSH_*`) environment variables configure capture
paths and the API client; see the lightning bridge package for offload
orchestration.