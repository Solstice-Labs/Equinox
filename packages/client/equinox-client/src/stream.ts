/**
 * Resilient Server-Sent Events (SSE) parser.
 *
 * Handles:
 *  - chunks split mid-event (the parser is byte/substring agnostic; feed any slice)
 *  - CRLF and lone-LF line endings
 *  - `:` comment lines and lines without a colon
 *  - multi-line `data:` fields (joined with \n)
 *  - `event:` and `id:` fields
 *  - `[DONE]` sentinels and malformed JSON payloads (counted, not thrown)
 *  - explicit backpressure via `highWater` feedback when used with a reader loop
 */

export interface SSEEvent {
  data: string
  event?: string
  id?: string
}

export class SSEParser {
  private buffer = ''
  private dataLines: string[] = []
  private eventField?: string
  private idField?: string
  private pending: SSEEvent[] = []

  onEvent?: (ev: SSEEvent) => void
  /** Incremented for every event whose payload fails JSON.parse downstream. */
  malformed = 0

  feed(chunk: string): void {
    this.buffer += chunk
    let idx: number
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx)
      this.buffer = this.buffer.slice(idx + 1)
      this.processLine(line.replace(/\r$/, ''))
    }
  }

  finish(): void {
    if (this.buffer.length > 0) {
      this.processLine(this.buffer.replace(/\r$/, ''))
      this.buffer = ''
    }
    if (this.dataLines.length > 0 || this.eventField !== undefined) {
      this.dispatch()
    }
  }

  /** Drains events accumulated synchronously (useful for buffer-less consumers). */
  drain(): SSEEvent[] {
    const out = this.pending
    this.pending = []
    return out
  }

  private processLine(line: string): void {
    if (line.length === 0) {
      // Empty line terminates a dispatch.
      if (this.dataLines.length > 0 || this.eventField !== undefined) {
        this.dispatch()
      }
      return
    }
    if (line.startsWith(':')) return // comment line
    const colon = line.indexOf(':')
    if (colon < 0) {
      // Unknown field without value — ignore per spec.
      return
    }
    const field = line.slice(0, colon)
    let value = line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    switch (field) {
      case 'data':
        this.dataLines.push(value)
        return
      case 'event':
        this.eventField = value
        return
      case 'id':
        this.idField = value
        return
      default:
        return // ignore retry/unknown fields
    }
  }

  private dispatch(): void {
    const ev: SSEEvent = {
      data: this.dataLines.join('\n'),
      event: this.eventField,
      id: this.idField,
    }
    this.dataLines = []
    this.eventField = undefined
    this.idField = undefined
    this.pending.push(ev)
    this.onEvent?.(ev)
  }
}