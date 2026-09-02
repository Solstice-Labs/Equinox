import { describe, expect, it } from 'vitest'

import { ConsecutiveErrorInterceptor } from '@solsticeai/distiller'

describe('ConsecutiveErrorInterceptor', () => {
  it('stays quiet on the first error', () => {
    const interceptor = new ConsecutiveErrorInterceptor()
    const ev = interceptor.record(1, new Error('boom'))
    expect(ev.triggered).toBe(false)
    expect(ev.consecutive).toBe(1)
  })

  it('triggers on the 2nd consecutive error', () => {
    const interceptor = new ConsecutiveErrorInterceptor()
    interceptor.record(1, new Error('a'))
    const ev = interceptor.record(2, new Error('b'))
    expect(ev.triggered).toBe(true)
  })

  it('re-arms after trigger (errors 3-4 trigger again)', () => {
    const interceptor = new ConsecutiveErrorInterceptor()
    interceptor.record(1, new Error('a'))
    expect(interceptor.record(2, new Error('b')).triggered).toBe(true)
    const third = interceptor.record(3, new Error('c'))
    expect(third.triggered).toBe(false)
    expect(third.consecutive).toBe(1)
    expect(interceptor.record(4, new Error('d')).triggered).toBe(true)
  })

  it('resets the streak when steps are not consecutive', () => {
    const interceptor = new ConsecutiveErrorInterceptor()
    interceptor.record(1, new Error('a'))
    const ev = interceptor.record(7, new Error('z'))
    expect(ev.consecutive).toBe(1)
    expect(ev.triggered).toBe(false)
  })

  it('reset() clears state', () => {
    const interceptor = new ConsecutiveErrorInterceptor()
    interceptor.record(1, new Error('a'))
    interceptor.record(2, new Error('b'))
    interceptor.reset()
    expect(interceptor.streak).toBe(0)
  })
})