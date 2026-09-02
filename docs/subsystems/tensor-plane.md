# Tensor plane (profiler, requant, lightning)

English | [中文](tensor-plane.zh.md)

The tensor plane of Project Equinox: deterministic offline model profiling
(`ctx.profiler`), asymmetric per-layer re-quantization (`ctx.requant`), and
Lightning AI cloud offload for the compute-heavy capture and build workloads
(`ctx.lightning`). Profiles drive the asymmetric precision plan; the re-quant
engine compiles that plan into llama.cpp invocations, executed locally or on
a Lightning Studio GPU.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxlightning--lightning"></a>

### `ctx.lightning` — `Lightning`

Plugin entry: registers the lightning bridge service on every context.

```ts cordis-catalog
/**
 * Re-read configuration from the current environment.
 * @returns the freshly loaded Equinox configuration.
 */
reload(): EquinoxConfig
```

Source: [`packages/cloud/equinox-lightning/src/index.ts`](../../packages/cloud/equinox-lightning/src/index.ts)

<a id="ctxprofiler--profiler"></a>

### `ctx.profiler` — `Profiler`

Plugin entry: registers the profiler service on every context.

```ts cordis-catalog
/**
 * The full 50-probe registry (10 per domain).
 * @returns the complete probe registry grouped by domain.
 */
probes(): typeof ALL_PROBES

/**
 * Structural sanity check over the probe set.
 * @returns the validation outcome with the failing probe checks.
 */
validate(): { ok: boolean; errors: string[] }

/**
 * Run the suite against a model client (or a mock for dry runs).
 * @param options the probe-suite execution options (model client, probe filter, budget).
 * @returns the probe results with per-domain scoring.
 */
runSuite(options: Parameters<typeof runProbeSuite>[0]): ReturnType<typeof runProbeSuite>

/**
 * Build a model profile from probe scores + layer stats.
 * @param input the probe results and optional layer statistics to fingerprint.
 * @returns the compiled model profile with fingerprint and policy.
 */
fingerprint(input: Parameters<typeof buildFingerprint>[0]): ReturnType<typeof buildFingerprint>

/**
 * Stable profile id used for artifact naming and drift baselines.
 * @param profile the model profile to identify.
 * @returns the stable profile id.
 */
profileId(profile: ModelProfile): string
```

Source: [`packages/profiler/equinox-profiler/src/index.ts`](../../packages/profiler/equinox-profiler/src/index.ts)

<a id="ctxrequant--requantizer"></a>

### `ctx.requant` — `Requantizer`

Plugin entry: registers the requantizer service on every context.

```ts cordis-catalog
/**
 * Run an asymmetric re-quantization pass for a profile.
 * @param options the quant plan, model path, and execution options for the pass.
 * @returns the re-quantization result with per-layer outcomes.
 */
run(options: Parameters<typeof runRequant>[0]): ReturnType<typeof runRequant>
```

Source: [`packages/distiller/equinox-requant/src/index.ts`](../../packages/distiller/equinox-requant/src/index.ts)
<!-- END GENERATED cordis-surface -->
