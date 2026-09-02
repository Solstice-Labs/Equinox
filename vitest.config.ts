import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@solsticeai/core': r('packages/core/equinox-core/src/index.ts'),
      '@solsticeai/lightning': r('packages/core/equinox-lightning/src/index.ts'),
      '@solsticeai/client': r('packages/client/equinox-client/src/index.ts'),
      '@solsticeai/profiler': r('packages/profiler/equinox-profiler/src/index.ts'),
      '@solsticeai/tools': r('packages/tools/equinox-tools/src/index.ts'),
      '@solsticeai/adapter': r('packages/adapter/equinox-adapter/src/index.ts'),
      '@solsticeai/distiller': r('packages/distiller/equinox-distiller/src/index.ts'),
    },
  },
  test: {
    include: ['packages/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
  },
})