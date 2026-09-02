---
description: "Lightning AI cloud compute bridge for Project Equinox — offloads compute-heavy tensor-plane workloads (50-probe diagnostics, llama-imatrix activation capture, asymmetric llama-quantize builds) from constrained local machines to a Lightning Studio GPU."
kind: "package-reference"
---

# @solsticeai/equinox-lightning

Lightning AI cloud compute bridge for Project Equinox — offloads the
compute-heavy tensor-plane workloads (50-probe diagnostics on larger models,
`llama-imatrix` activation capture, asymmetric `llama-quantize` builds) from
constrained local machines to a Lightning Studio GPU.

## Summary

`equinox-lightning` moves the compute-heavy tensor-plane workloads of Project
Equinox onto a Lightning Studio GPU when the local machine lacks the VRAM,
CPU, or disk. Local resource probes plus `EQUINOX_CLOUD=1` decide local vs
cloud execution; argv builders compile precise CLI invocations (including
per-layer asymmetric `--tensor-type` quants), and `lightning job run` /
`lightning cp` orchestrate the bundle upload, remote execution, and artifact
pull-back. `EQUINOX_DRY_RUN=1` prints every command instead of executing, so
deployments can preview any dispatch before touching a live studio.

## Table of Contents

- [Usage](#usage)
- [Configuration](#configuration)
- [Dev Note](#dev-note)

## Usage
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

## Configuration

Config reads `EQUINOX_*` first, falling back to the harness's `DSH_*` keys:
`EQUINOX_LIGHTNING_STUDIO`, `EQUINOX_LIGHTNING_OWNER`,
`EQUINOX_LIGHTNING_TEAMSPACE`, `EQUINOX_LIGHTNING_MACHINE`,
`EQUINOX_CLOUD`, `EQUINOX_DRY_RUN`, `EQUINOX_QUANTIZE_BIN`,
`EQUINOX_IMATRIX_BIN`.

The config-read order is `EQUINOX_*` first, then the `DSH_*` fallback,
per the harness-wide environment convention.

## Dev Note

This package runs in the cloud-execution plane only; none of its jobs touch
the local model cache or require a GPU on the developer machine.