# @solsticeai/equinox-lightning

Lightning AI cloud compute bridge for the DeepSeek Harness — offloads the
compute-heavy tensor-plane workloads (50-probe diagnostics on larger models,
`llama-imatrix` activation capture, asymmetric `llama-quantize` builds) from
constrained local machines to a Lightning Studio GPU.

## What it does

- **Offload detection** — local resource probes (GPU presence, memory, CPU
  count, free disk) plus `EQUINOX_CLOUD=1` decide local vs cloud execution.
- **argv builders** — `buildImatrixArgs`, `buildQuantizeArgs`,
  `buildRemoteJobArgs` compile precise CLI invocations, including
  `--tensor-type "blk\\.(N)\\.attn_.*=q8_0"` per-layer asymmetric quants.
- **Job orchestration** — `lightning job run --studio <studio> --machine T4
  --command "…"`, `lightning cp` bundle upload / artifact pull-back, and
  `lightning job inspect` polling to completion.
- **Dry-run mode** — `EQUINOX_DRY_RUN=1` prints every command instead of
  executing, for safe preview on live environments.

Config reads `EQUINOX_*` first, falling back to the harness's `DSH_*` keys:
`EQUINOX_LIGHTNING_STUDIO`, `EQUINOX_LIGHTNING_OWNER`,
`EQUINOX_LIGHTNING_TEAMSPACE`, `EQUINOX_LIGHTNING_MACHINE`,
`EQUINOX_CLOUD`, `EQUINOX_DRY_RUN`, `EQUINOX_QUANTIZE_BIN`,
`EQUINOX_IMATRIX_BIN`.

## Usage

```ts
import { Context } from '@solsticeai/cordis'
import Lightning, { EquinoxBridge } from '@solsticeai/equinox-lightning'
import { loadConfig } from '@solsticeai/equinox-lightning'

const ctx = new Context()
await ctx.plugin(Lightning)

const bridge = new EquinoxBridge(loadConfig())
const result = await bridge.dispatch({
  name: 'imatrix-llama-8b',
  command: 'llama-imatrix -m model.gguf -f corpus.txt -o model.imatrix.dat',
  outputs: ['model.imatrix.dat'],
})
```

Set `EQUINOX_DRY_RUN=1` to preview the exact dispatch before touching a live
studio.