import { describe, expect, it } from 'vitest'

import { SSEParser } from '@solsticeai/client'

function collect(chunks: string[]): { events: { data: string; event?: string; id?: string }[]; malformed: number } {
  const parser = new SSEParser()
  const events: { data: string; event?: string; id?: string }[] = []
  parser.onEvent = (ev) => events.push(ev)
  for (const c of chunks) parser.feed(c)
  parser.finish()
  return { events, malformed: parser.malformed }
}

describe('SSEParser', () => {
  it('parses a single event', () => {
    const { events } = collect(['data: hello\n\n'])
    expect(events).toEqual([{ data: 'hello', event: undefined, id: undefined }])
  })

  it('parses multiple events', () => {
    const { events } = collect(['data: one\n\ndata: two\n\n'])
    expect(events.map((e) => e.data)).toEqual(['one', 'two'])
  })

  it('joins multi-line data fields with newline', () => {
    const { events } = collect(['data: line1\ndata: line2\n\n'])
    expect(events).toHaveLength(1)
    expect(events[0]!.data).toBe('line1\nline2')
  })

  it('handles chunks split mid-line and mid-event', () => {
    const { events } = collect(['da', 'ta: hel', 'lo\n\n', 'data: wor', 'ld\n\n'])
    expect(events.map((e) => e.data)).toEqual(['hello', 'world'])
  })

  it('handles CRLF line endings', () => {
    const { events } = collect(['data: crlf\r\n\r\n'])
    expect(events.map((e) => e.data)).toEqual(['crlf'])
  })

  it('ignores comment lines and unknown fields', () => {
    const { events } = collect([': ping\nretry: 1000\ndata: keep\n\n'])
    expect(events.map((e) => e.data)).toEqual(['keep'])
  })

  it('parses event and id fields', () => {
    const { events } = collect(['id: 42\nevent: delta\ndata: {}\n\n'])
    expect(events[0]).toEqual({ data: '{}', event: 'delta', id: '42' })
  })

  it('parses [DONE] sentinel', () => {
    const { events } = collect(['data: [DONE]\n\n'])
    expect(events.map((e) => e.data)).toEqual(['[DONE]'])
  })

  it('handles no-space data colon (data:value)', () => {
    const { events } = collect(['data:{"a":1}\n\n'])
    expect(events.map((e) => e.data)).toEqual(['{"a":1}'])
  })

  it('flushes a trailing event without a blank line', () => {
    const { events } = collect(['data: trailing'])
    expect(events.map((e) => e.data)).toEqual(['trailing'])
  })

  it('preserves data after the single leading space is stripped', () => {
    const { events } = collect(['data:\n\n', 'data:    \n\n'])
    expect(events.map((e) => e.data)).toEqual(['', '   '])
  })
})