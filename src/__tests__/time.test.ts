import { describe, expect, it } from 'vitest'
import { parseSnTime } from '../utils/time'

describe('SN UTC timestamps', () => {
  it.each(['2026-09-27 02:48:08', '2026-09-27T02:48:08'])('interprets timezone-less UTC value %s correctly', (value) => {
    expect(parseSnTime(value).toISOString()).toBe('2026-09-27T02:48:08.000Z')
    expect(parseSnTime(value).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false })).toBe('2026-09-27 10:48:08')
  })

  it.each(['2026-09-27T02:48:08Z', '2026-09-27T10:48:08+08:00', '2026-09-26T22:48:08-04:00'])('preserves the ISO timezone in %s', (value) => {
    expect(parseSnTime(value).toISOString()).toBe('2026-09-27T02:48:08.000Z')
  })

  it.each([1790477288, '1790477288', 1790477288000, '1790477288000'])('preserves Unix seconds or milliseconds in %s', (value) => {
    expect(parseSnTime(value).toISOString()).toBe('2026-09-27T02:48:08.000Z')
  })

  it('preserves fractional seconds and invalid-date detection', () => {
    expect(parseSnTime('2026-09-27 02:48:08.123').toISOString()).toBe('2026-09-27T02:48:08.123Z')
    expect(Number.isNaN(parseSnTime('not-a-date').getTime())).toBe(true)
  })
})
