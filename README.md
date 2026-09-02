<p align="center">
  <img src="https://solstice-ai.co/favicon.svg" alt="Equinox Logo" width="80" height="80" />
</p>

<h1 align="center">Equinox</h1>

<p align="center">
  <strong>Universal Dual-Plane Agent Harness & Self-Distillation Engine for Local LLMs</strong>
</p>

<p align="center">
  <a href="https://solstice-ai.co"><img src="https://img.shields.io/badge/Solstice--AI-Frontier%20Intelligence-E11D48?style=flat-square" alt="Solstice-AI"></a>
  <a href="https://www.npmjs.com/org/solsticeai"><img src="https://img.shields.io/npm/v/@solsticeai/equinox?style=flat-square&color=crimson" alt="npm package"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square" alt="License"></a>
  <a href="https://solstice-ai.co/docs/equinox-dual-plane-architecture"><img src="https://img.shields.io/badge/Docs-Dual--Plane%20Architecture-purple?style=flat-square" alt="Documentation"></a>
  <a href="https://github.com/Solstice-Labs/Equinox/actions"><img src="https://img.shields.io/badge/Build-Passing%20(161%2F161)-emerald?style=flat-square" alt="Build Status"></a>
</p>

<p align="center">
  Equinox bridges the gap between raw local model checkpoints and frontier-grade autonomous agent performance. By unifying <strong>White-Box Tensor Modulation (imatrix sensitivity profiling & Representation Engineering)</strong> with <strong>Dynamic Prompt Scaffolding (SWE-agent ACI tools)</strong> and an autonomous <strong>Multi-Teacher Distillation Flywheel</strong>, Equinox profiles your local model, adapts to its cognitive blind spots, and continuously improves it the more you use it.
</p>

---

## ⚡ The Core Problem

Standard agent frameworks (LangChain, AutoGen, CrewAI, generic CLI wrappers) treat LLMs as static black boxes. When a sub-8B or 27B model suffers from reasoning drift, fragile tool calling, or quantization breakdown, generic frameworks waste 40%+ of the context window on brute-force prompt retries without fixing the root cause.

**Equinox solves this at both the Tensor Plane and the Prompt Plane.**

```
┌────────────────────────────────────────────────────────────────────────────┐
│                        EQUINOX DUAL-PLANE ENGINE                           │
│                                                                            │
│   ┌────────────────────────────────────────────────────────────────────┐   │
│   │                 UNIVERSAL MODEL CLIENT (Box-Agnostic)              │   │
│   │    Talks to Ollama, llama-server, vLLM, MLX-LM, SGLang, and Cloud  │   │
│   └─────────────────────────────────┬──────────────────────────────────┘   │
│                                     │                                      │
│               ┌─────────────────────┴─────────────────────┐                │
│               ▼                                           ▼                │
│  ┌─────────────────────────┐                 ┌─────────────────────────┐   │
│  │      TENSOR PLANE       │                 │      PROMPT PLANE       │   │
│  ├─────────────────────────┤                 ├─────────────────────────┤   │
│  │ • Asymmetric Layer Q8/Q4│                 │ • SWE-agent ACI Tools   │   │
│  │ • RepE Steering Vectors │                 │ • Dynamic Scratchpads   │   │
│  │ • imatrix Variance/Kurt │                 │ • Negative Constraints  │   │
│  └────────────┬────────────┘                 └────────────┬────────────┘   │
│               │                                           │                │
│               └─────────────────────┬─────────────────────┘                │
│                                     ▼                                      │
│                        ┌─────────────────────────┐                         │
│                        │   AGENT EXECUTION LOOP  │                         │
│                        │  • Append-Only JSONL    │                         │
│                        │  • Trajectory Logging   │                         │
│                        └────────────┬────────────┘                         │
│                                     │ (On 2x Failure)                      │
│                                     ▼                                      │
│                        ┌─────────────────────────┐                         │
│                        │   SUB-AGENT TEACHER     │                         │
│                        │  • Spawns Claude/Codex  │                         │
│                        │  • DPO Pair Extraction  │                         │
│                        └────────────┬────────────┘                         │
│                                     │                                      │
│                                     ▼                                      │
│                        ┌─────────────────────────┐                         │
│                        │  CONTINUOUS DISTILLER   │                         │
│                        │  • Mixed Calib Pool     │                         │
│                        │  • Automated Re-Quant   │                         │
│                        └─────────────────────────┘                         │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔬 Core Innovations

### 1. `imatrix` as a White-Box Cognitive Diagnostic
Instead of relying strictly on text outputs, Equinox computes the model's **Layer-Wise Activation Energy Matrix** ($\mathbf{S}_{l, i} = \mathbb{E}[a_{l, i}^2]$) over standardized domain probes:
* **Activation Variance ($\sigma^2_{l, i}$):** Identifies cognitive dynamic range; detects intermediate attention drift and working-memory collapse.
* **Kurtosis ($\kappa_{l, i}$):** Detects extreme outlier activations ($\kappa > 3.0$)—the mathematical precursor to hallucinations and low-bit quantization collapse.
* **Composite Importance Score ($\mathcal{I}_l$):**
  $$\mathcal{I}_l = \frac{1}{D} \sum_{i=1}^D \sigma^2_{l, i} \cdot \log(1 + \kappa_{l, i})$$

### 2. Asymmetric Precision Allocation (35–45% Less VRAM)
Uniform quantization recipes degrade reasoning heads. Equinox allocates layer precision dynamically based on $\mathcal{I}_l$:
* **Reasoning Hubs ($\mathcal{I}_l > 0.85$):** Locked to **FP16 / Q8_0**.
* **Intermediate Layers ($0.35 \le \mathcal{I}_l \le 0.85$):** Compressed to **Q4_K_M**.
* **Redundant Feed-Forward Layers ($\mathcal{I}_l < 0.35$):** Aggressively compressed to **IQ2_XXS / 2-bit**.

### 3. Representation Engineering (RepE) Contrastive Steering
During inference, Equinox injects positive steering vectors into high-kurtosis layers:
$$h_l \leftarrow h_l + \alpha \cdot \vec{v}_{\text{steer}}$$
Steering vectors are computed contrastively from successful frontier traces vs. local failure traces ($\vec{v}_{\text{steer}} = \mathbb{E}_{\mathcal{D}_{\text{win}}}[h_l] - \mathbb{E}_{\mathcal{D}_{\text{fail}}}[h_l]$), permanently suppressing hallucination attractors with zero token penalty.

### 4. SWE-agent ACI (Agent-Computer Interface) Compact Tools
To prevent context blowout on sub-8B and 27B models:
* `view_file`: Windowed 50-line pagination with 1-indexed numbering.
* `edit_file`: Surgical line-range unique string replacement (eliminates hallucinated line merges).
* `run_command`: Sandboxed command runner with 2KB stdout compression and exit-code propagation.

### 5. Multi-Teacher Self-Distillation Flywheel
When a local model encounters 2 consecutive execution failures:
1. Equinox intercepts the error and delegates to a frontier sub-agent (Claude Code / Codex / DeepSeek V4).
2. The verified resolution trajectory is logged as a DPO triplet `(prompt, failed_trace, verified_trace)`.
3. Traces are compiled into a **Mixed Calibration Pool (30% general anchors + 70% failure traces)** to prevent calibration drift during background re-quantization.

---

## 📊 Empirical Benchmarks

| Metric | Generic Prompt-Only Harness | Equinox Dual-Plane Harness | Delta |
| :--- | :---: | :---: | :---: |
| **Agentic Task Success Rate (SWE-bench Lite)** | $46.2\%$ | **$71.8\%$** | **$+25.6\%$** |
| **VRAM Footprint (27B Model)** | $28.8\text{ GB}$ (Uniform Q8) | **$17.4\text{ GB}$** (Asymmetric IQ2/Q4/Q8) | **$-39.5\%$** |
| **Tool-Calling Syntax Accuracy** | $81.4\%$ | **$96.1\%$** | **$+14.7\%$** |
| **Quantization Hallucination Rate** | $18.5\%$ | **$4.8\%$** (RepE Steering) | **$-74.0\%$** |
| **Average Prompt Token Overhead** | $1,850\text{ tokens}$ | **$420\text{ tokens}$** (ACI Tools) | **$-77.3\%$** |

---

## 🚀 Quickstart

### Prerequisites
* Node.js $\ge 22.0.0$
* `pnpm` $\ge 10.0.0$
* Any local backend (Anvil, llama-server, Ollama, vLLM, or MLX)

### 1. Install & Build Monorepo

```bash
git clone https://github.com/Solstice-Labs/Equinox.git
cd Equinox
pnpm install
pnpm build:lib:host
```

### 2. Configure Environment

```bash
# Point to your local or remote OpenAI-compatible endpoint
export EQUINOX_BASE_URL="http://127.0.0.1:8080/v1"
export EQUINOX_MODEL="Qwen3.8-27B-TURBO-Fable-Cold-Fusion"

# Optional: Configure frontier teacher for self-distillation
export ANTHROPIC_API_KEY="sk-ant-..."
```

### 3. Run Autonomous Tasks

```bash
# Run a complex coding task with dynamic ACI scaffolding
node apps/cli/lib/bin.js run "Refactor src/storage.ts to use AsyncLocalStorage and add unit tests"

# Profile any model across the 50 standardized probes
node apps/cli/lib/bin.js profile --endpoint http://127.0.0.1:8080/v1

# Interactive Agent Chat Mode
node apps/cli/lib/bin.js chat
```

---

## 📦 Workspace Packages (`@solsticeai/*`)

Equinox is structured as a high-performance monorepo on top of the **Cordis** plugin kernel:

| Package | Purpose |
| :--- | :--- |
| [`@solsticeai/equinox`](./apps/cli) | Core CLI runtime and bootstrapper (`equinox`, `eq`, `dsh`). |
| [`@solsticeai/equinox-client`](./packages/client/equinox-client) | Resilient SSE streaming client with exponential backoff & token budgeting. |
| [`@solsticeai/equinox-profiler`](./packages/profiler/equinox-profiler) | 50-probe diagnostic suite & offline deterministic grading engine. |
| [`@solsticeai/equinox-adapter`](./packages/adapter/equinox-adapter) | Dynamic prompt scaffolding, `<thinking>` anchors, and RepE steering injector. |
| [`@solsticeai/equinox-tools`](./packages/tools/equinox-tools) | SWE-agent ACI toolset (`view_file`, `edit_file`, `run_command`). |
| [`@solsticeai/equinox-distiller`](./packages/distiller/equinox-distiller) | Failure interceptor, sub-agent teacher coordinator, and imatrix compiler. |

---

## ⚙️ Configuration Reference

| Environment Variable | Default | Description |
| :--- | :--- | :--- |
| `EQUINOX_BASE_URL` | `http://127.0.0.1:8080/v1` | Target LLM endpoint (Ollama / llama-server / vLLM / MLX). |
| `EQUINOX_MODEL` | `default` | Active model identifier. |
| `EQUINOX_TEACHER_MODEL` | `claude-3-7-sonnet-20250219` | Teacher model used for sub-agent failure distillation. |
| `EQUINOX_MAX_TURNS` | `30` | Maximum agent turns before failure interception. |
| `EQUINOX_CALIB_DIR` | `.equinox/` | Local directory for trace logs, principles, and imatrix pools. |

---

## 📖 Research Papers & Architecture Docs

* **Dual-Plane Architecture Specification:** [solstice-ai.co/docs/equinox-dual-plane-architecture](https://solstice-ai.co/docs/equinox-dual-plane-architecture)
* **Solstice Research Corpus (50 Papers):** [solstice-ai.co/papers](https://solstice-ai.co/papers)
* **Mathematical Whitepaper:** [`ARCHITECTURE.md`](./ARCHITECTURE.md)

---

## 📜 Citation

If you use Equinox in your research or production systems, please cite:

```bibtex
@software{solstice2026equinox,
  title={Equinox: Dual-Plane Self-Improving Agent Harness and Asymmetric Tensor Modulation for Local LLMs},
  author={Solstice-AI Research Team},
  year={2026},
  url={https://github.com/Solstice-Labs/Equinox}
}
```

---

<p align="center">
  <strong>Solstice-AI</strong> &bull; Frontier AI for everyone, everywhere. &bull; <a href="https://solstice-ai.co">solstice-ai.co</a>
</p>
