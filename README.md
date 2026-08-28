# Equinox

> **Self-improving agent harness for local open-source LLMs** — Solstice-AI.
> Status: Pre-MVP (first slice: Profiler + Adapter + failure capture).

Equinox profiles any local model, learns from its failures, and adapts the
harness to that specific model — the opening turn of the self-distillation
flywheel:

```
Usage → Profiling → Adaptation → Failure Capture → (next slice) Distillation
```

This repo is the first, lean slice. It deliberately avoids the DeepSeek Harness
(Cordis) substrate for now, deferring that dependency until the sub-agent
"teacher" system in the Distiller milestone actually needs it. Everything here
talks to **any OpenAI-compatible endpoint**, so it runs against llama-server,
Ollama, vLLM, build.nvidia.com, or a future Anvil engine without changes.

## Modules

| Module | File | Responsibility |
|--------|------|----------------|
| Model client | `src/model-client.ts` | Box-agnostic OpenAI-compatible HTTP client (native fetch) |
| Probe suite | `src/probes.ts` | Deterministic, gradeable probes across coding / reasoning / tool_use / math / instruction_following |
| Profiler | `src/profiler.ts` | Runs probes, grades offline (keyword heuristics, no judge model), emits `model-profile.json` |
| Adapter | `src/adapter.ts` | Reads the profile → system prompt, temperature, tool-call style, task-splitting rule |
| Session log | `src/session-log.ts` | Append-only JSONL event log (replayable; raw material for the Distiller) |
| CLI | `src/cli.ts` | `profile` / `adapt` / `run` commands |

## Why lean / no-DSH yet

The one genuinely valuable piece of DSH for this project is its **sub-agent**
system — the "teacher" in the distillation loop. That only matters at the
distillation milestone. Wiring the whole product to a dev-preview framework now
(before we've proven the flywheel) front-loads the document's #1 flagged risk
(DSH API instability) for no near-term payoff. We keep DSH in the back pocket
as a narrowly-scoped adapter for the sub-agent lane when we reach it.

## Install & run

```bash
# needs Node >= 20
npm install
npm run build   # tsc -> dist/

# point at your endpoint
export EQUINOX_BASE_URL=http://127.0.0.1:8080/v1
export EQUINOX_MODEL=qwen3-8b-q4_k_m
# optional
export EQUINOX_API_KEY=sk-...

node dist/cli.js profile
node dist/cli.js adapt
node dist/cli.js run "Refactor this function to use async/await" --category=coding
```

## `model-profile.json`

The emitted fingerprint captures per-category capability scores, behavioral
style (concise/verbose), tool preferences, and observed failure patterns with
mitigations — exactly what the Adapter (and later the Distiller) consumes.

## Next slices

1. **Failure Logging → Distiller** — turn captured failures into calibration
   training data for the quantization lane (Unsloth-style / ultraquant Bonsai).
2. **Sub-agent teacher** — the frontier-model "teacher" lane (this is where DSH
   earns its place, via sub-agents driving Claude Code/Codex as child processes).
3. **Quantized rebuild** — feed calibrated data back into better quants of the
   same model; re-profile to measure improvement.

## License

MIT