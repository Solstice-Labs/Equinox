# Equinox — Self-Improving Agent Harness for Local LLMs

> **Project:** Equinox · **Org:** Solstice-AI · **Status:** Architecture / Pre-MVP
> **Date:** August 28, 2026

---

## 1. What Is Equinox

Equinox is a self-improving agent harness for local open-source LLMs. It profiles any local model, learns from its failures, self-distills training data to produce better quantized versions of itself, and writes its own tools — all while getting better the more you use it.

The core insight: **local models are now frontier-class** (Qwen 3.8 27B beats Claude Opus 4.6 on 16 of 24 benchmarks), but the tooling layer for them is still generic. Nobody builds harnesses optimized for specific local models. Equinox fixes that.

**The flywheel:**
```
Usage → Profiling → Adaptation → Failure Learning → Self-Distillation → Better Quants → Better Experience → More Usage
```

---

## 2. The Name

- **Solstice-AI** — the org
- **Anvil** — the inference engine (llama.cpp fork)
- **Equinox** — the self-improving intelligence layer

Solstice/Equinox are celestial opposites — longest day vs. balanced day. Anvil/Equinox are functional opposites — raw engine vs. intelligence layer.

---

## 3. Why This Doesn't Exist Yet

### What exists in pieces:

| Component | What Exists | Who Built It | Gap |
|---|---|---|---|
| Agent harnesses | DeepSeek Harness, Pi, OpenClaw, Goose | Various | None are model-specific or self-improving |
| Self-improving harnesses | Self-Harness paper (arXiv, Jun 2026) | Princeton | Academic paper, no product |
| On-device learning | OpenJarvis (Stanford) | Stanford | Not focused on quantization or tool creation |
| Self-evolving skills | EvoSkills (arXiv, Apr 2026) | Various | Runs on frontier APIs, not local models |
| Speculative decoding | DSpark | DeepSeek | Exists, needs integration |
| KV cache compression | TurboQuant | Google | Exists on vLLM, not on Anvil |
| Advanced quantization | Unsloth Dynamic 3.0 | Unsloth | Exists, needs calibration data pipeline |
| Model profiling | Cursor does per-model tuning | Cursor | Proprietary, not for local models |
| Agent writing own tools | OpenClaw, Hermes Agent | Various | Not optimized for local model quirks |

### What doesn't exist:

Nobody connects **self-improving harness + local model profiling + self-distillation for imatrix quants + dynamic skill/tool creation** into one product. The pieces exist separately. The integration doesn't.

---

## 4. The Tech Stack

### Core Stack

| Layer | Technology | Role |
|---|---|---|
| **Inference Engine** | Anvil (our llama.cpp fork) | Runs the model locally |
| **Agent Runtime** | DeepSeek Harness (MIT) | Plugin architecture, sub-agents, traceability |
| **Intelligence Layer** | Equinox (our product) | Profiling, learning, self-distillation, skill creation |

### Integration Stack

| Technology | What It Does | Integration Approach |
|---|---|---|
| **DSpark** | Speculative decoding, 2.22x faster on consumer GPUs | Model Adapter plugin |
| **TurboQuant** | KV cache compression, 6x memory reduction | KVCache plugin (needs Anvil integration) |
| **Unsloth Dynamic 3.0** | >10% better accuracy at same quant size | Quantizer plugin with custom calibration data |

### Why DeepSeek Harness as the base

| Factor | DeepSeek Harness | Pi |
|---|---|---|
| **License** | MIT | Open source |
| **Plugin depth** | Everything is a plugin (model, tools, loop, UI) | Extensions hook into lifecycle |
| **Agent loop** | Swappable (it's a plugin itself) | Fixed (you extend around it) |
| **Sub-agents** | Can drive Claude Code/Codex as child processes | No |
| **Traceability** | Event-sourced sessions (append-only, replay, fork) | Basic |
| **Stability** | Dev preview, API may change | Mature, stable |
| **Local models** | OpenAI-compatible API | pi-local-models package |
| **Stars** | 165k+ (Aug 13, 2026) | Established ecosystem |

**Decision:** DeepSeek Harness. The sub-agent capability is critical — it's the teacher in the self-distillation loop. Without sub-agents, the local model has no one to learn from. With sub-agents, every frontier model call becomes a distillation opportunity.

**Bridge:** `pi2dsh` package runs Pi extensions as DeepSeek Harness plugins, so we get Pi's ecosystem too.

---

## 5. Architecture

### 5.1 Layered Design

```
┌─────────────────────────────────────────────────────┐
│                  Equinox Intelligence Layer           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ │
│  │ Profiler │ │ Adapter  │ │Distiller │ │ Skill  │ │
│  │          │ │          │ │          │ │Creator │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └───┬────┘ │
│       │             │            │            │      │
│       └──────┬──────┴──────┬─────┴────┬───────┘      │
│              │  Event Bus  │          │              │
├──────────────┴─────────────┴──────────┴──────────────┤
│              DeepSeek Harness (Cordis)                │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ │
│  │  Model   │ │   Tool   │ │ Session  │ │ Sub-   │ │
│  │ Adapter  │ │ Registry │ │ Manager  │ │Agents  │ │
│  └────┬─────┘ └──────────┘ └──────────┘ └────────┘ │
├───────┴──────────────────────────────────────────────┤
│              Anvil (Inference Engine)                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │ DSpark   │ │TurboQuant│ │ Unsloth  │            │
│  │Spec.Dec. │ │KV Cache  │ │ Dynamic  │            │
│  └──────────┘ └──────────┘ └──────────┘            │
└─────────────────────────────────────────────────────┘
```

### 5.2 Component Responsibilities

**Model Interface Layer**
- Engine-agnostic access to local LLMs via unified API
- Request routing to different inference backends
- Response normalization across output formats
- Context management (KV cache, memory optimization)
- Session management with append-only logging

**Profiler (Model Fingerprinting)**
- Runs standardized probe suite on any model (100 prompts across coding, reasoning, tool use, math)
- Measures: accuracy per category, token efficiency, failure modes, formatting preferences, tool call style
- Outputs a Model Profile (JSON config) capturing strengths, weaknesses, and optimal configurations
- Re-profiles when model changes are detected

**Adapter (Adaptive Harness)**
- Reads Model Profile and adjusts dynamically
- System prompts tailored to model strengths
- Tool call formatting adapted to how the model actually outputs them
- Retry strategies based on known failure modes
- Context window management based on actual effective context

**Distiller (Self-Distillation Loop)**
- Captures every task: input, output, success/failure, token count, time
- Analyzes failure patterns across sessions
- Generates training data: "here's what went wrong, here's the correct reasoning trace"
- Feeds calibration data into Unsloth Dynamic 3.0 for better imatrix quants
- Produces model-specific quantized versions optimized for the user's actual task distribution

**Skill Creator (Dynamic Tool Generation)**
- Detects capability gaps through failure analysis
- Generates new tools/skills as TypeScript modules
- Tests in sandboxed environment (Docker, resource-limited)
- Registers successful skills in the tool library
- Skills are optimized for the current model's behavior

### 5.3 Event-Driven Communication

Plugins communicate via an event bus:
- `on_task_complete` — Profiler logs success patterns
- `on_failure_detected` — Distiller captures context, Adapter adjusts strategy
- `on_profile_updated` — Adapter reconfigures prompts and tools
- `on_calibration_ready` — Distiller triggers re-quantization
- `on_skill_generated` — Tool Registry registers new capability

---

## 6. The Self-Improving Loop

### 6.1 Loop Mechanics

```
1. Model does a task
2. Harness captures: input, output, success/failure, tokens, time
3. Profiler updates Model Profile with new data
4. Adapter adjusts: prompts, tool formats, retry strategies
5. Distiller generates training data from failures
6. Unsloth produces better quantized model
7. Skill Creator writes new tools for recurring failure patterns
8. Better model + better harness + new tools = better experience
9. More usage → more data → repeat
```

### 6.2 Sub-Agent Distillation

The key innovation: when the local model fails, it delegates to a frontier model (Claude Code, Codex) as a sub-agent via DSH's sub-agent system. The frontier model's correct output becomes training data for the local model.

```
Local model fails → Delegate to Claude/Codex sub-agent → 
Frontier model produces correct output → 
Output becomes calibration data → 
Local model re-quantized with better data → 
Local model improves at that task type
```

This is the teacher mechanism. Without sub-agents, the self-distillation loop has no teacher. With sub-agents, every frontier model call is a distillation opportunity.

### 6.3 Model Profile Schema

```yaml
model_info:
  name: "Qwen3-27B-Instruct"
  version: "v3.8"
  quantization: "Q4_K_M"
  inference_engine: "Anvil"

behavioral_fingerprint:
  response_style: "concise"
  preferred_formatting: "markdown"
  code_style: "modular"
  tool_preferences: ["file_editor", "shell", "web_search"]

capability_scores:
  coding: 8.5/10
  reasoning: 7.8/10
  tool_use: 8.2/10
  instruction_following: 8.0/10

failure_patterns:
  - pattern: "complex tool chaining"
    frequency: "medium"
    mitigation: "break down tasks"
  - pattern: "ambiguous error recovery"
    frequency: "high"
    mitigation: "explicit error messages"

quantization_characteristics:
  optimal_bits: 4
  sensitive_layers: ["attention.output", "mlp.dense_4h_to_h"]
  recommended_method: "Unsloth Dynamic 3.0"
  imatrix_calibration_data: "profile_2026-08-28.json"
```

---

## 7. Integration Details

### 7.1 DSpark (Speculative Decoding)

- **What:** DeepSeek's speculative decoding framework, 2.22x faster on consumer GPUs
- **How:** Model Adapter plugin that activates DSpark based on model profile and task type
- **When:** Latency-sensitive tasks (coding assistants, interactive use). Disable for batch processing.
- **Fallback:** Automatic disabling when quality degradation detected

### 7.2 TurboQuant (KV Cache Compression)

- **What:** Google's KV cache compression, 6x memory reduction (ICLR 2026)
- **Status:** Works on vLLM. llama.cpp rejected it. MLX has community implementation.
- **How:** KVCache plugin that intercepts model's KV cache and applies compression
- **Challenge:** Needs custom integration into Anvil (our llama.cpp fork). Not plug-and-play.
- **When:** Long-context tasks where KV cache is the bottleneck

### 7.3 Unsloth Dynamic 3.0 (Quantization)

- **What:** >10% better accuracy at same quant size vs. every other method
- **Status:** Just dropped Aug 20, 2026. GGUF format. Works with imatrix calibration.
- **How:** Quantizer plugin that calls Unsloth's CLI with custom calibration data from the Distiller
- **Key:** We provide the calibration data (from failures), Unsloth produces the quant. Domain-specific, failure-informed quantization that generic Unsloth doesn't offer.

---

## 8. Landscape Analysis (August 2026)

### What's happening right now:

- **Qwen 3.8 27B** beats Claude Opus 4.6 on 16/24 benchmarks, especially agentic coding
- **GLM 5.3** proved "post-training is all you need" — same base model, massive gains from post-training alone
- **MCP went stateless** (July 2026) — agents connect to more tools with no session tracking
- **DeepSeek Harness** just shipped (Aug 13) — MIT, everything-is-a-plugin, 165k+ stars
- **Unsloth Dynamic 3.0** just dropped (Aug 20) — >10% better accuracy at same quant size
- **Token costs are 10x after the demo** — production cost explosion is a known crisis
- **AI solved 10 open math problems for $2,000** (Astra, Aug 1) — AI can do original research

### Why now:

Local models are frontier-class. The tooling layer hasn't caught up. Everyone builds harnesses for API models. Nobody builds harnesses that get better at using YOUR specific local model.

---

## 9. MVP vs Full Vision

### MVP (8-12 weeks)

| Component | Scope |
|---|---|
| **Base** | DeepSeek Harness (pinned version) |
| **Profiler** | Simple capability assessment: coding, reasoning, tool use |
| **Adapter** | Rule-based: "if coding task, use code mode" |
| **Failure Logging** | Capture failures with context |
| **Distillation** | Manual trigger: human generates calibration data from failures |
| **Quantization** | Manual: run Unsloth with our calibration data |
| **Skill Creation** | Read-only tool plugins only |
| **Engine** | Anvil (single engine) |

**MVP success criteria:**
- Demonstrable improvement in task completion after profiling and adaptation
- One custom quant that measurably outperforms the default quant on our task distribution
- One generated skill that fixes a common failure pattern
- Clear evidence the flywheel works

### Full Vision (12-18 months)

| Component | Scope |
|---|---|
| **Profiler** | Full behavioral fingerprinting, cross-model comparison |
| **Adapter** | AI-driven: generates and tests prompt/tool format variations |
| **Distillation** | Automated continuous loop, no human intervention |
| **Quantization** | Automatic re-quantization when calibration data crosses threshold |
| **Skill Creation** | Full sandboxed code generation with verification |
| **Integrations** | DSpark, TurboQuant, Unsloth all integrated |
| **UI** | Dashboard showing profile, improvement over time, skill evolution |
| **Multi-engine** | Anvil + llama.cpp + vLLM |
| **Community** | Profile and skill sharing marketplace |

---

## 10. Risks and Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| **DSH API instability** | High | Pin version, wrap with abstraction layer, migrate if needed |
| **Circular distillation** | High | Use sub-agents (frontier models) as teacher, not the local model itself |
| **Overfitting calibration data** | Medium | Diverse validation sets, cross-validation against general benchmarks |
| **Generated code security** | High | Docker sandbox, static analysis, human review for critical skills |
| **Reward hacking** | Medium | Multi-objective optimization, held-out validation sets, human audits |
| **Resource exhaustion** | Medium | Resource budgets for improvement activities, scheduling during low-activity |
| **Complexity death spiral** | Medium | Radical observability — every plugin logs decisions, "explain why" tracing |
| **TurboQuant Anvil integration** | Medium | May need custom work. Fallback: skip TurboQuant for MVP. |

---

## 11. Decision Log

| Decision | Choice | Rationale |
|---|---|---|
| Harness base | DeepSeek Harness | Sub-agents are critical for self-distillation loop |
| Fallback harness | Pi | Stable, minimal, `pi2dsh` bridge exists |
| Inference engine | Anvil | Our fork, full control |
| Quantization | Unsloth Dynamic 3.0 | Best accuracy at same size, imatrix support |
| Speculative decoding | DSpark | 2.22x speedup, works with local models |
| KV cache | TurboQuant | 6x memory reduction, but needs Anvil integration work |
| Language | TypeScript | Matches DSH ecosystem, plugin compatibility |
| License | MIT | Match DSH, maximize adoption |

---

## 12. Open Questions

1. **TurboQuant on Anvil** — how much work to integrate? Can we skip it for MVP?
2. **Sub-agent cost** — every frontier model call costs money. How do we balance distillation quality vs. API cost?
3. **Profile sharing** — should users share model profiles? Could create a community database of optimal configs per model.
4. **Quant distribution** — if every user gets a custom quant, how do we handle distribution and support?
5. **DSH migration path** — if DSH breaks, how hard is it to move to Pi? The `pi2dsh` bridge suggests it's possible.

---

*The sun never sets on AETHER. The more you use Equinox, the better it gets.*
