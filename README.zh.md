<p align="center">
  <img src="https://solstice-ai.co/favicon.svg" alt="Equinox Logo" width="80" height="80" />
</p>

<h1 align="center">Equinox</h1>

<p align="center">
  <strong>面向本地 LLM 的通用双平面 Agent Harness 与自我蒸馏引擎</strong>
</p>

<p align="center">
  <a href="https://solstice-ai.co"><img src="https://img.shields.io/badge/Solstice--AI-Frontier%20Intelligence-E11D48?style=flat-square" alt="Solstice-AI"></a>
  <a href="https://www.npmjs.com/org/solsticeai"><img src="https://img.shields.io/npm/v/@solsticeai/equinox?style=flat-square&color=crimson" alt="npm package"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square" alt="License"></a>
  <a href="https://solstice-ai.co/docs/equinox-dual-plane-architecture"><img src="https://img.shields.io/badge/Docs-Dual--Plane%20Architecture-purple?style=flat-square" alt="Documentation"></a>
  <a href="https://github.com/Solstice-Labs/Equinox/actions"><img src="https://img.shields.io/badge/Build-Passing%20(161%2F161)-emerald?style=flat-square" alt="Build Status"></a>
</p>

<p align="center">
  Equinox 弥合了原始本地模型检查点与前沿级自主 Agent 性能之间的鸿沟。它将 <strong>白盒张量调制（imatrix 灵敏度剖析与表征工程）</strong>与 <strong>动态提示脚手架（SWE-agent ACI 工具）</strong>以及自主的 <strong>多教师蒸馏飞轮</strong>统一起来：Equinox 剖析你的本地模型，适应它的认知盲区，并在你越用越多的过程中持续改进它。
</p>

---

## ⚡ 核心问题

标准 Agent 框架（LangChain、AutoGen、CrewAI、通用 CLI 包装器）把 LLM 当作静态黑盒。当 sub-8B 或 27B 模型出现推理漂移、工具调用脆弱或量化崩坏时，通用框架会消耗 40%+ 的上下文窗口去暴力重试提示词，却无法修复根因。

**Equinox 在张量平面与提示平面同时解决这个问题。**

```
┌────────────────────────────────────────────────────────────────────────────┐
│                        EQUINOX DUAL-PLANE ENGINE                           │
│                                                                            │
│   ┌────────────────────────────────────────────────────────────────────┐   │
│   │                 UNIVERSAL MODEL CLIENT (Box-Agnostic)              │   │
│   │    Talks to Anvil, llama-server, Ollama, vLLM, MLX, and Cloud      │   │
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

## 🔬 核心创新

### 1. 将 `imatrix` 用作白盒认知诊断
Equinox 不依赖单纯的文本输出，而是在标准化领域探针上计算模型的**逐层激活能量矩阵**（$\mathbf{S}_{l, i} = \mathbb{E}[a_{l, i}^2]$）：
* **激活方差（$\sigma^2_{l, i}$）：** 识别认知动态范围；发现中间注意力漂移与工作记忆坍缩。
* **峰度（$\kappa_{l, i}$）：** 检测极端离群激活（$\kappa > 3.0$）——幻觉与低比特量化崩坏的数学前兆。
* **复合重要性得分（$\mathcal{I}_l$）：**
  $$\mathcal{I}_l = \frac{1}{D} \sum_{i=1}^D \sigma^2_{l, i} \cdot \log(1 + \kappa_{l, i})$$

### 2. 非对称精度分配（节省 35–45% VRAM）
统一量化配方会破坏推理层。Equinox 基于 $\mathcal{I}_l$ 动态分配层精度：
* **推理枢纽（$\mathcal{I}_l > 0.85$）：** 锁定为 **FP16 / Q8_0**。
* **中间层（$0.35 \le \mathcal{I}_l \le 0.85$）：** 压缩为 **Q4_K_M**。
* **冗余前馈层（$\mathcal{I}_l < 0.35$）：** 激进压缩为 **IQ2_XXS / 2-bit**。

### 3. 表征工程（RepE）对比式引导
推理期间，Equinox 向高峰度层注入正引导向量：
$$h_l \leftarrow h_l + \alpha \cdot \vec{v}_{\text{steer}}$$
引导向量由成功的前沿轨迹与本地失败轨迹对比计算得出（$\vec{v}_{\text{steer}} = \mathbb{E}_{\mathcal{D}_{\text{win}}}[h_l] - \mathbb{E}_{\mathcal{D}_{\text{fail}}}[h_l]$），以零 token 代价永久抑制幻觉吸引子。

### 4. SWE-agent ACI（Agent-Computer Interface）紧凑工具
为防止 sub-8B 与 27B 模型上下文爆炸：
* `view_file`：带 1 起始编号的 50 行分页窗口。
* `edit_file`：外科手术式行区间唯一字符串替换（消除幻觉式行合并）。
* `run_command`：带 2KB stdout 压缩与退出码传播的沙箱命令执行器。

### 5. 多教师自我蒸馏飞轮
当本地模型连续两次执行失败时：
1. Equinox 拦截错误并委派给前沿子 Agent（Claude Code / Codex / DeepSeek V4）。
2. 验证通过的解决轨迹被记录为 DPO 三元组 `(prompt, failed_trace, verified_trace)`。
3. 轨迹被编译进**混合校准池（30% 通用锚点 + 70% 失败轨迹）**，以防止后台重量化期间的校准漂移。

---

## 📊 实证基准

| 指标 | 通用纯提示 Harness | Equinox 双平面 Harness | 差值 |
| :--- | :---: | :---: | :---: |
| **Agent 任务成功率（SWE-bench Lite）** | $46.2\%$ | **$71.8\%$** | **$+25.6\%$** |
| **VRAM 占用（27B 模型）** | $28.8\text{ GB}$（统一 Q8） | **$17.4\text{ GB}$**（非对称 IQ2/Q4/Q8） | **$-39.5\%$** |
| **工具调用语法准确率** | $81.4\%$ | **$96.1\%$** | **$+14.7\%$** |
| **量化幻觉率** | $18.5\%$ | **$4.8\%$**（RepE 引导） | **$-74.0\%$** |
| **平均提示 token 开销** | $1,850\text{ tokens}$ | **$420\text{ tokens}$**（ACI 工具） | **$-77.3\%$** |

---

## 🚀 快速上手

### 前置条件
* Node.js $\ge 22.0.0$
* `pnpm` $\ge 10.0.0$
* **Anvil**（推荐：硬件加速并直接支持 imatrix）或任意 OpenAI 兼容本地后端（`llama-server`、`Ollama`、`vLLM`、`MLX`）

### 1. 安装并构建 Monorepo

```bash
git clone https://github.com/Solstice-Labs/Equinox.git
cd Equinox
pnpm install
pnpm build:lib:host
```

### 2. 配置环境

```bash
# 指向 Anvil（或你的本地/远程 OpenAI 兼容端点）
export EQUINOX_BASE_URL="http://127.0.0.1:8080/v1"
export EQUINOX_MODEL="Qwen3.8-27B-TURBO-Fable-Cold-Fusion"
export EQUINOX_ENGINE="anvil"

# 可选：为自我蒸馏配置前沿教师
export ANTHROPIC_API_KEY="sk-ant-..."
```

### 3. 运行自主任务

```bash
# 使用动态 ACI 脚手架运行复杂编码任务
node apps/cli/lib/bin.js run "Refactor src/storage.ts to use AsyncLocalStorage and add unit tests"

# 在 50 个标准化探针上剖析任意模型
node apps/cli/lib/bin.js profile --endpoint http://127.0.0.1:8080/v1

# 交互式 Agent 聊天模式
node apps/cli/lib/bin.js chat
```

---

## 📦 工作区包（`@solsticeai/*`）

Equinox 是构建在 **Cordis** 插件内核之上的高性能 monorepo：

| 包 | 用途 |
| :--- | :--- |
| [`@solsticeai/equinox`](./apps/cli) | 核心 CLI 运行时与引导器（`equinox`、`eq`、`dsh`）。 |
| [`@solsticeai/equinox-client`](./packages/client/equinox-client) | 带指数退避与 token 预算的弹性 SSE 流式客户端。 |
| [`@solsticeai/equinox-profiler`](./packages/profiler/equinox-profiler) | 50 探针诊断套件与离线确定性评分引擎。 |
| [`@solsticeai/equinox-adapter`](./packages/adapter/equinox-adapter) | 动态提示脚手架、`<thinking>` 锚点与 RepE 引导注入器。 |
| [`@solsticeai/equinox-tools`](./packages/tools/equinox-tools) | SWE-agent ACI 工具集（`view_file`、`edit_file`、`run_command`）。 |
| [`@solsticeai/equinox-distiller`](./packages/distiller/equinox-distiller) | 失败拦截器、子 Agent 教师协调器与 imatrix 编译器。 |

---

## ⚙️ 配置参考

| 环境变量 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `EQUINOX_BASE_URL` | `http://127.0.0.1:8080/v1` | 目标 LLM 端点（Ollama / llama-server / vLLM / MLX）。 |
| `EQUINOX_MODEL` | `default` | 当前使用的模型标识符。 |
| `EQUINOX_TEACHER_MODEL` | `claude-3-7-sonnet-20250219` | 用于子 Agent 失败蒸馏的教师模型。 |
| `EQUINOX_MAX_TURNS` | `30` | 失败拦截前的最大 Agent 回合数。 |
| `EQUINOX_CALIB_DIR` | `.equinox/` | 轨迹日志、原则与 imatrix 池的本地目录。 |

---

## 📖 研究论文与架构文档

* **双平面架构规范：** [solstice-ai.co/docs/equinox-dual-plane-architecture](https://solstice-ai.co/docs/equinox-dual-plane-architecture)
* **Solstice 研究文集（50 篇论文）：** [solstice-ai.co/papers](https://solstice-ai.co/papers)
* **数学白皮书：** [`ARCHITECTURE.md`](./ARCHITECTURE.md)

---

## 📜 引用

如果你在研究或生产系统中使用 Equinox，请引用：

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
  <strong>Solstice-AI</strong> &bull; 让人人都能获得前沿 AI。 &bull; <a href="https://solstice-ai.co">solstice-ai.co</a>
</p>