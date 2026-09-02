import { describe, expect, it } from 'vitest'

import { OpenAIClient } from '../src/index.ts'

interface RecordedCall {
  url: string
  init: RequestInit
}

/**
 * Adapt a handler that sees plain (url, init) args into a `typeof fetch`
 * implementation, recording each request for assertions.
 */
function recordingFetch(handler: (call: RecordedCall) => Response | Promise<Response>): typeof fetch {
  return async (input, init) => {
    // This client always passes a plain string URL.
    const url = input instanceof URL ? input.href : (input as string)
    return handler({ url, init: init ?? {} })
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('OpenAIClient.sample', () => {
  it('posts a chat-completions request and parses text + logprobs', async () => {
    const calls: RecordedCall[] = []
    const client = new OpenAIClient({
      baseUrl: 'https://example.test/v1',
      apiKey: 'sk-test',
      model: 'model-x',
      fetchImpl: recordingFetch((call) => {
        calls.push(call)
        return jsonResponse({
          id: 'cmpl-1',
          model: 'model-x',
          choices: [{ message: { content: 'const x = 1' }, finish_reason: 'stop' }],
          logprobs: { content: [{ token: 'const', logprob: -0.2 }, { token: ' x', logprob: -0.7 }] },
        })
      }),
    })
    const result = await client.sample(
      [{ role: 'user', content: 'hi' }],
      { temperature: 0.9, seed: 7, maxTokens: 32, logprobs: true },
    )
    expect(result.text).toBe('const x = 1')
    expect(result.logprobs).toHaveLength(2)
    expect(result.logprobs?.[0]?.logprob).toBeCloseTo(-0.2)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://example.test/v1/chat/completions')
    const headers = calls[0]?.init.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer sk-test')
    const body = JSON.parse(calls[0]?.init.body as string) as Record<string, unknown>
    expect(body['model']).toBe('model-x')
    expect(body['temperature']).toBe(0.9)
    expect(body['seed']).toBe(7)
    expect(body['max_tokens']).toBe(32)
    expect(body['logprobs']).toBe(true)
  })

  it('returns null logprobs when the endpoint does not expose them', async () => {
    const client = new OpenAIClient({
      baseUrl: 'https://example.test/v1',
      model: 'm',
      fetchImpl: recordingFetch(() => jsonResponse({ choices: [{ message: { content: 'ok' } }] })),
    })
    const result = await client.sample([{ role: 'user', content: 'hi' }], { logprobs: true })
    expect(result.logprobs).toBeNull()
    expect(result.text).toBe('ok')
  })

  it('retries a 429 and honors Retry-After', async () => {
    let attempts = 0
    const client = new OpenAIClient({
      baseUrl: 'https://example.test/v1',
      model: 'm',
      maxRetries: 3,
      fetchImpl: recordingFetch(() => {
        attempts += 1
        if (attempts === 1) {
          return new Response('rate limited', { status: 429, headers: { 'Retry-After': '1' } })
        }
        return jsonResponse({ choices: [{ message: { content: 'ok' } }] })
      }),
    })
    const result = await client.sample([{ role: 'user', content: 'hi' }])
    expect(result.text).toBe('ok')
    expect(attempts).toBe(2)
  })

  it('retries a 503 with exponential backoff and succeeds', async () => {
    let attempts = 0
    const client = new OpenAIClient({
      baseUrl: 'https://example.test/v1',
      model: 'm',
      maxRetries: 3,
      fetchImpl: recordingFetch(() => {
        attempts += 1
        if (attempts === 1) return new Response('unavailable', { status: 503 })
        return jsonResponse({ choices: [{ message: { content: 'ok' } }] })
      }),
    })
    const result = await client.sample([{ role: 'user', content: 'hi' }])
    expect(result.text).toBe('ok')
    expect(attempts).toBe(2)
  })

  it('surfaces a non-retryable status without retrying', async () => {
    let attempts = 0
    const client = new OpenAIClient({
      baseUrl: 'https://example.test/v1',
      model: 'm',
      maxRetries: 3,
      fetchImpl: recordingFetch(() => {
        attempts += 1
        return jsonResponse({ error: { message: 'bad request' } }, 400)
      }),
    })
    await expect(client.sample([{ role: 'user', content: 'hi' }])).rejects.toThrow(/HTTP 400/)
    expect(attempts).toBe(1)
  })

  it('throws after retries are exhausted', async () => {
    let attempts = 0
    const client = new OpenAIClient({
      baseUrl: 'https://example.test/v1',
      model: 'm',
      maxRetries: 1,
      fetchImpl: recordingFetch(() => {
        attempts += 1
        return new Response('busy', { status: 503 })
      }),
    })
    await expect(client.sample([{ role: 'user', content: 'hi' }])).rejects.toThrow(/retries exhausted/)
    expect(attempts).toBe(2)
  })

  it('parses the empty completion content string safely', async () => {
    const client = new OpenAIClient({
      baseUrl: 'https://example.test/v1',
      model: 'm',
      fetchImpl: recordingFetch(() => jsonResponse({ choices: [] })),
    })
    const result = await client.sample([{ role: 'user', content: 'hi' }])
    expect(result.text).toBe('')
  })
})

describe('OpenAIClient.chat', () => {
  it('satisfies the ModelClient contract', async () => {
    const client = new OpenAIClient({
      baseUrl: 'https://example.test/v1',
      apiKey: 'k',
      model: 'm',
      fetchImpl: recordingFetch(() => jsonResponse({ id: 'cmpl-9', model: 'm', choices: [{ message: { content: 'answer' } }] })),
    })
    const result = await client.chat([{ role: 'system', content: 'be terse' }], { temperature: 0.1 })
    expect(result.message.content).toBe('answer')
    expect(result.model).toBe('m')
  })
})

describe('OpenAIClient env fallback', () => {
  it('reads EQUINOX_* first, then DSH_*, then explicit options', () => {
    const dshEnv = {
      DSH_API_BASE_URL: 'https://dsh.test',
      DSH_API_KEY: 'dsh-key',
      DSH_API_MODEL: 'dsh-model',
    } as const
    const fromDsh = new OpenAIClient({ env: dshEnv })
    expect(fromDsh.baseUrl).toBe('https://dsh.test')
    expect(fromDsh.model).toBe('dsh-model')

    const equinoxEnv = {
      ...dshEnv,
      EQUINOX_API_BASE_URL: 'https://eq.test',
      EQUINOX_API_MODEL: 'eq-model',
    } as const
    const fromEquinox = new OpenAIClient({ env: equinoxEnv })
    expect(fromEquinox.baseUrl).toBe('https://eq.test')
    expect(fromEquinox.model).toBe('eq-model')

    const defaults = new OpenAIClient({ env: {}, model: 'explicit' })
    expect(defaults.baseUrl).toBe('https://api.openai.com/v1')
    expect(defaults.model).toBe('explicit')
  })

  it('never sends an Authorization header without a key', async () => {
    const calls: RecordedCall[] = []
    const client = new OpenAIClient({
      baseUrl: 'https://example.test/v1',
      model: 'm',
      fetchImpl: recordingFetch((call) => {
        calls.push(call)
        return jsonResponse({ choices: [{ message: { content: 'ok' } }] })
      }),
    })
    await client.sample([{ role: 'user', content: 'hi' }])
    const headers = calls[0]?.init.headers as Record<string, string>
    expect(headers['Authorization']).toBeUndefined()
  })
})
