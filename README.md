# Project Equinox

A universal, model-agnostic, self-improving agent harness for local and open-source LLMs.
Talks to **any OpenAI-compatible endpoint** (llama.cpp `llama-server`, Ollama, vLLM, SGLang,
MLX-LM, or cloud APIs), profiles models across **50 deterministic probes**, captures per-layer
activation statistics (locally via `llama-imatrix` or exactly via hidden states on a Lightning
GPU), and compiles the results into **asymmetric per-layer quantization plans** executed with
`llama-quantize --tensor-type`. When the local machine is too weak (no GPU / low RAM / low disk),
compute-heavy work is delegated to a Lightning AI Studio (`EQUINOX_LIGHTNING_STUDIO`).

## Monorepo layout

```
packages/
├── core/equinox-core        @solsticeai/core        env (EQUINOX_* → DSH_*), dual-plane math, shared types, hash-chained JSONL
├── core/equinox-lightning   @solsticeai/lightning   cloud bridge: offload detection, llama.cpp argv builders, job dispatch/pull
├── client/equinox-client    @solsticeai/client      resilient SSE parser + box-agnostic HTTP client (retry/backoff/backpressure)
├── tools/equinox-tools      @solsticeai/tools       SWE-agent ACI tools: view_file / edit_file / run_command + sandbox FS
├── profiler/equinox-profiler @solsticeai/profiler   50 probes (5 domains × 10), deterministic graders, 2 capture backends, fingerprint
├── adapter/equinox-adapter  @solsticeai/adapter     profile-driven prompts, scratchpads, temperatures; agent loop w/ trajectory log
└── distiller/equinox-distiller @solsticeai/distiller error interceptor, teacher sub-agents, DPO traces, calibration pool, re-quant engine
```

## The dual-plane math

| Quantity | Formula | Meaning |
|---|---|---|
| Activation variance | σ²ᵢ = E[(a − μ)²] | information dynamic range per dimension |
| Kurtosis | κᵢ = E[(a − μ)⁴] / (σ²)⁴ | κ > 3 ⇒ outlier activations / hallucination precursors |
| Composite importance | 𝓘ₗ = (1/D) Σᵢ σ²ᵢ · log(1 + κᵢ) | layer importance (reasoning hubs) |

Scores are min-max normalized to [0, 1] and mapped to asymmetric precision:

| 𝓘ₗ | Precision |
|---|---|
| > 0.85 | **FP16 / Q8_0** — reasoning hubs |
| 0.35 – 0.85 | **Q4_K_M** — intermediate support |
| < 0.35 | **IQ2_XXS** — redundant layers |

The plan compiles into `llama-quantize` per-layer tensor rules such as:

```bash
llama-quantize --imatrix model.imatrix.dat \
  --token-embedding-type q4_k --output-tensor-type q8_0 \
  --tensor-type "blk\.(0|1)\.attn_.*=iq2_xxs" \
  --tensor-type "blk\.(0|1)\.ffn_.*=iq2_xxs" \
  --tensor-type "blk\.(28)\.attn_.*=q8_0" \
  model.gguf model-q.gguf Q4_K_M
```

## Activation capture — two backends, both available

- **`imatrix-proxy` (universal, no GPU):** parses `llama-imatrix` `.dat` files (second moments
  per tensor) → per-layer variance proxy with the Gaussian kurtosis prior (κ = 3). Works on any
  GGUF model llama.cpp can run.
- **`hidden-states` (exact):** a rendered Python script accumulates streaming moments
  (n, Σx, Σx², Σx³, Σx⁴) per layer via `output_hidden_states=True` and computes exact σ², κ, 𝓘ₗ;
  designed to be dispatched to a Lightning GPU.

## Env configuration

Every option reads **`EQUINOX_*` first, then `DSH_*`**, then a default.

| Key | Default | Purpose |
|---|---|---|
| `BASE_URL` / `API_KEY` / `MODEL` | `http://localhost:8080/v1` | any OpenAI-compatible endpoint |
| `CLOUD` | `false` | force offload |
| `DRY_RUN` | `false` | print Lightning commands instead of running them |
| `LIGHTNING_STUDIO` | — | studio name (e.g. `converter`) |
| `LIGHTNING_TEAMSPACE` / `LIGHTNING_OWNER` | — | needed for `lit://` URLs |
| `LIGHTNING_MACHINE` | `T4` | job machine type |
| `IMATRIX_BIN` / `QUANTIZE_BIN` | `llama-imatrix` / `llama-quantize` | llama.cpp binary paths |
| `TEACHER` | `api` | `api` \| `claude` \| `codex` \| `gemini` |
| `TEACHER_CMD` | — | override teacher CLI argv |
| `CAL_POOL_SIZE` | `512` | calibration pool size |
| `SCRATCHPAD_DRIFT` | `0.65` | composite-drift threshold for `<thinking>` injection |
| `TEMP_CODE` / `TEMP_REASONING` | `0.1` / `0.6` | temperature policy |
| `HOME_DIR` | `.equinox` | artifacts root |

## Build & test

```bash
pnpm install
pnpm test             # 161 vitest tests
pnpm typecheck        # tsc --noEmit, 0 errors
pnpm build:lib:host   # all 7 packages (esm + .d.ts via tsdown)
pnpm build:lib:client # core + client + tools
```

## End-to-end sketch

```ts
// 1. Profile any model through any endpoint
const client = EquinoxClient.fromConfig(loadConfig())
const suite = await runProbeSuite({ client })
const stats = loadImatrixCapture({ datFile })          // or hidden-states capture
const profile = buildFingerprint({
  model, backend: stats.backend, domainScores: suite.domainScores,
  probeComposite: suite.composite, layerStats: stats.stats,
})

// 2. Re-quantize asymmetrically (imatrix-first; offloads when needed)
const manifest = await runRequant({ profile, modelIn: 'model.gguf', modelOut: 'model-q.gguf', corpus })

// 3. Distill: intercept 2x failures → teacher → DPO trace → calibration pool
const traces = new DistillationTraces()
const pool = compileCalibrationPool({ anchors, recoveries, poolSize: 512, seed: 42 })
```

## License

MIT — see [LICENSE](./LICENSE).