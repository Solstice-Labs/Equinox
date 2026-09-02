# Equinox

> **Universal Self-Improving Agent Harness for Local & Open-Source LLMs** — Solstice-AI.
> Foundation: Pre-forked from [DeepSeek Harness (`deepseek-ai/deepseek-harness`)](https://github.com/Solstice-Labs/Equinox).

Equinox transforms any local or remote model into an autonomous, self-improving reasoning agent. By combining **DeepSeek Harness's plugin-first runtime** with **Solstice's Dual-Plane Activation Profiler (`imatrix`) & Self-Distillation Flywheel**, Equinox profiles your model, adapts to its cognitive strengths, learns from failures, and produces optimized quantization recipes.

```
Usage ──> Profiling ──> Dynamic Adaptation ──> Failure Capture ──> Sub-Agent Teacher ──> imatrix Calib ──> Better Quants
```

---

## The Equinox Dual-Plane Architecture

1. **The Tensor Plane (Hardware & Quantization):**
   * Layer-wise second-order activation sensitivity analysis ($S_{l, i} = \mathbb{E}[a_{l, i}^2]$).
   * **Asymmetric Layer Bitrates:** Allocates FP16 / Q8 to critical reasoning attention hubs while aggressively compressing redundant layers to 2-bit/3-bit IQ formats (saving 35–45% VRAM without losing IQ).
   * **Representation Engineering (RepE):** Injects contrastive steering vectors directly into intermediate hidden states ($h_l \leftarrow h_l + \alpha \cdot \vec{v}_{\text{steer}}$).

2. **The Prompt Plane (Harness Scaffolding):**
   * Dynamic system prompt synthesis tailored to model quirks.
   * Automated `<thinking>` scratchpad injection for multi-step reasoning.
   * Agent-Computer Interface (ACI) compact tool outputs to prevent context bloat.

3. **The Self-Distillation Flywheel:**
   * Unresolved task errors automatically delegate to frontier sub-agent teachers (Claude Code / Codex / DeepSeek V4).
   * Verified teacher resolution traces are compiled into a failure-informed `imatrix` calibration pool for automated background re-quantization.

---

## Modules & Ecosystem

Built on the modular **Cordis** kernel, every capability is decoupled as a swappable plugin:

| Module | Role |
| :--- | :--- |
| **Model Interface** | Box-agnostic OpenAI-compatible HTTP/SSE client (Anvil, llama-server, Ollama, vLLM, MLX, Cloud) |
| **Profiler Engine** | Standardized 50-probe test suite across coding, reasoning, math, and tool-use |
| **Adaptive Scaffolding** | Reads `model-profile.json` and adjusts system prompts, temperatures, and tool formats |
| **Session Store** | Event-sourced, append-only JSONL trajectories for replay, forking, and distillation |
| **Sub-Agent Coordinator** | Drives child processes as teachers for automated failure recovery |

---

## Quickstart

```bash
# Clone and build
git clone https://github.com/Solstice-Labs/Equinox.git
cd Equinox
pnpm install
pnpm build

# Configure your endpoint (Ollama, llama-server, vLLM, or Anvil)
export EQUINOX_BASE_URL=http://127.0.0.1:8080/v1
export EQUINOX_MODEL=qwen3-27b-q4_k_m

# Profile your model
pnpm equinox profile

# Run autonomous tasks with dynamic scaffolding
pnpm equinox run "Refactor src/db.ts to use connection pooling"

# Interactive terminal agent
pnpm equinox chat
```

---

## Documentation & Research

* **Architecture Whitepaper:** [`ARCHITECTURE.md`](./ARCHITECTURE.md)
* **Solstice-AI Specification:** [solstice-ai.co/docs/equinox-dual-plane-architecture](https://solstice-ai.co/docs/equinox-dual-plane-architecture)

---

## License

MIT License &copy; 2026 Solstice-AI & DeepSeek AI.
