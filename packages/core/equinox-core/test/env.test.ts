import { describe, expect, it } from 'vitest'

import { loadConfig, readBool, readEnv, readInt } from '@solsticeai/core'

describe('env resolution', () => {
  it('readEnv prefers EQUINOX_* over DSH_* over fallback', () => {
    expect(readEnv('BASE_URL', 'http://fallback', {})).toEqual({ value: 'http://fallback', source: 'default' })
    expect(readEnv('BASE_URL', 'x', { DSH_BASE_URL: 'http://dsh' })).toEqual({ value: 'http://dsh', source: 'DSH' })
    expect(readEnv('BASE_URL', 'x', { EQUINOX_BASE_URL: 'http://eq' })).toEqual({
      value: 'http://eq',
      source: 'EQUINOX',
    })
    expect(readEnv('BASE_URL', 'x', { EQUINOX_BASE_URL: 'http://eq', DSH_BASE_URL: 'http://dsh' })).toEqual({
      value: 'http://eq',
      source: 'EQUINOX',
    })
  })

  it('treats empty-string env values as unset', () => {
    expect(readEnv('MODEL', 'fallback', { EQUINOX_MODEL: '' })).toEqual({ value: 'fallback', source: 'default' })
  })

  it('readInt falls back on garbage', () => {
    expect(readInt('TIMEOUT', 5, { DSH_TIMEOUT: 'abc' })).toEqual({ value: 5, source: 'default' })
    expect(readInt('TIMEOUT', 5, { EQUINOX_TIMEOUT: '42' })).toEqual({ value: 42, source: 'EQUINOX' })
  })

  it('readBool parses truthy strings', () => {
    expect(readBool('CLOUD', false, { EQUINOX_CLOUD: '1' }).value).toBe(true)
    expect(readBool('CLOUD', false, { DSH_CLOUD: 'TRUE' }).value).toBe(true)
    expect(readBool('CLOUD', false, { EQUINOX_CLOUD: 'no' }).value).toBe(false)
    expect(readBool('CLOUD', true, {}).value).toBe(true)
  })
})

describe('loadConfig', () => {
  it('assembles a full config from EQUINOX_* env', () => {
    const cfg = loadConfig({
      EQUINOX_BASE_URL: 'http://llama.local:8080/v1',
      EQUINOX_API_KEY: 'sk-test',
      EQUINOX_MODEL: 'qwen3-4b',
      EQUINOX_TEACHER: 'gemini',
      EQUINOX_CLOUD: 'true',
      EQUINOX_LIGHTNING_STUDIO: 'converter',
    })
    expect(cfg.baseUrl).toBe('http://llama.local:8080/v1')
    expect(cfg.apiKey).toBe('sk-test')
    expect(cfg.model).toBe('qwen3-4b')
    expect(cfg.teacher).toBe('gemini')
    expect(cfg.cloud).toBe(true)
    expect(cfg.lightningStudio).toBe('converter')
  })

  it('falls back to DSH_* when EQUINOX_* is absent', () => {
    const cfg = loadConfig({ DSH_BASE_URL: 'http://dsh:1234/v1', DSH_MODEL: 'dsh-model' })
    expect(cfg.baseUrl).toBe('http://dsh:1234/v1')
    expect(cfg.model).toBe('dsh-model')
  })

  it('defaults when nothing is set', () => {
    const cfg = loadConfig({})
    expect(cfg.baseUrl).toBe('http://localhost:8080/v1')
    expect(cfg.teacher).toBe('api')
    expect(cfg.cloud).toBe(false)
    expect(cfg.tempCode).toBe(0.1)
    expect(cfg.tempReasoning).toBe(0.6)
  })

  it('infers ollama provider from its default port', () => {
    const cfg = loadConfig({ EQUINOX_BASE_URL: 'http://localhost:11434/v1' })
    expect(cfg.provider).toBe('ollama')
  })
})