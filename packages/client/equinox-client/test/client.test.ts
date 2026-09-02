import { describe, expect, it, vi } from 'vitest'

import { EquinoxClient, HttpError, translateEvent } from '@solsticeai/client'
import type { ChatMessage } from '@solsticeai/core'

function sseBody(events: string[]): Uint8Array {
  const text = events.join('\n\n') + '\n\n'
  return new TextEncoder().encode(text)
}

function streamResponse(events: string[], status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(sseBody(events))
      controller.close()
    },
  })
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } })
}

function jsonResponse(payload: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

const MSG: ChatMessage[] = [{ role: 'user', content: 'hi' }]

function clientWith(fetchImpl: typeof fetch): EquinoxClient {
  return new EquinoxClient({ baseUrl: 'http://test/v1', model: 'm', fetchImpl, maxRetries: 2, backoffBaseMs: 0 })
}

describe('EquinoxClient.chat', () => {
  it('returns a parsed ChatResult', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        id: 'cmpl-1',
        model: 'm',
        choices: [{ message: { role: 'assistant', content: 'hi there' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      }),
    )
    const res = await clientWith(fetchImpl as unknown as typeof fetch).chat(MSG)
    expect(res.message.content).toBe('hi there')
    expect(res.usage.totalTokens).toBe(8)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('parses tool_calls into typed ToolCall[]', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        choices: [
          {
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'view_file', arguments: '{"path":"a.ts"}' } }],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: {},
      }),
    )
    const res = await clientWith(fetchImpl as unknown as typeof fetch).chat(MSG)
    expect(res.message.tool_calls?.[0]).toMatchObject({ id: 'call_1', name: 'view_file', arguments: { path: 'a.ts' } })
    expect(res.finishReason).toBe('tool_calls')
  })

  it('retries 429 and 503 with Retry-After, then succeeds', async () => {
    const calls = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'rate' }, 429, { 'retry-after': '0' }))
      .mockResolvedValueOnce(jsonResponse({ error: 'down' }, 503, { 'retry-after': '0' }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: {} }))
    const res = await clientWith(calls as unknown as typeof fetch).chat(MSG)
    expect(res.finishReason).toBe('stop')
    expect(calls).toHaveBeenCalledTimes(3)
  })

  it('does not retry 4xx client errors and surfaces HttpError', async () => {
    const calls = vi.fn(async () => jsonResponse({ error: 'bad request' }, 400))
    const err = await clientWith(calls as unknown as typeof fetch).chat(MSG).catch((e) => e)
    expect(err).toBeInstanceOf(HttpError)
    expect((err as HttpError).status).toBe(400)
    expect(calls).toHaveBeenCalledTimes(1)
  })

  it('gives up after exhausting retries', async () => {
    const calls = vi.fn(async () => jsonResponse({ error: 'boom' }, 500))
    const err = await clientWith(calls as unknown as typeof fetch).chat(MSG).catch((e) => e)
    expect(err).toBeInstanceOf(HttpError)
    expect((err as HttpError).status).toBe(500)
    expect(calls).toHaveBeenCalledTimes(3)
  })

  it('normalizes base URLs (trailing slash, full path)', () => {
    const c = new EquinoxClient({ baseUrl: 'http://x/v1/', model: 'm', fetchImpl: vi.fn() as unknown as typeof fetch })
    expect((c as unknown as { baseUrl: string }).baseUrl).toBe('http://x/v1')
  })
})

describe('EquinoxClient.chatStream', () => {
  it('yields content deltas and finish reason', async () => {
    const events = [
      'data: {"id":"1","choices":[{"delta":{"content":"Hel"},"finish_reason":null}]}',
      'data: {"id":"1","choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}]}',
      'data: [DONE]',
    ]
    const c = clientWith((async () => streamResponse(events)) as unknown as typeof fetch)
    const chunks: string[] = []
    let finish: string | undefined
    for await (const chunk of c.chatStream(MSG)) {
      chunks.push(chunk.content)
      if (chunk.finishReason) finish = chunk.finishReason
    }
    expect(chunks.join('')).toBe('Hello')
    expect(finish).toBe('stop')
  })

  it('accumulates streamed tool call argument fragments', () => {
    const toolState = new Map<number, { id: string; name: string; args: string }>()
    const first = translateEvent('{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"edit_file","arguments":"{\\"path\\":\\""}}]}}]}', toolState)
    expect(first).toBeNull() // args fragment not yet valid JSON
    const second = translateEvent('{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"a.ts\\"}"}}]}}]}', toolState)
    expect(second?.toolCalls?.[0]).toEqual({ id: 'c1', name: 'edit_file', arguments: { path: 'a.ts' } })
  })

  it('tolerates a malformed JSON event mid-stream', async () => {
    const events = [
      'data: {"choices":[{"delta":{"content":"a"},"finish_reason":null}]}',
      'data: NOT-JSON{{',
      'data: {"choices":[{"delta":{"content":"b"},"finish_reason":"stop"}]}',
      'data: [DONE]',
    ]
    const c = clientWith((async () => streamResponse(events)) as unknown as typeof fetch)
    let text = ''
    for await (const chunk of c.chatStream(MSG)) text += chunk.content
    expect(text).toBe('ab')
  })
})

describe('EquinoxClient helpers', () => {
  it('health() returns false when the endpoint is down', async () => {
    const c = clientWith((async () => jsonResponse({ ok: true }, 503)) as unknown as typeof fetch)
    expect(await c.health()).toBe(false)
  })

  it('models() lists ids', async () => {
    const c = clientWith((async () => jsonResponse({ data: [{ id: 'm1' }, { id: 'm2' }] })) as unknown as typeof fetch)
    expect(await c.models()).toEqual(['m1', 'm2'])
  })
})