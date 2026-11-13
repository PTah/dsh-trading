import { describe, expect, it } from 'vitest'
import { monthWindowFromIndex, monthsBefore } from '../src/client/chart-window.ts'

const DAY = 24 * 60 * 60

function dailyTimes(lastSec: number, days: number): number[] {
  const out: number[] = []
  for (let index = days - 1; index >= 0; index--) out.push(lastSec - index * DAY)
  return out
}

describe('chart month window', () => {
  it('Agent: clamps a month-end back into the shorter month', () => {
    const march31 = Date.UTC(2026, 2, 31, 12, 0, 0)
    expect(new Date(monthsBefore(march31, 1)).toISOString()).toBe('2026-02-28T12:00:00.000Z')
  })

  it('Agent: the 6-month window starts near the bar half a year before the last one', () => {
    const last = Date.UTC(2026, 10, 10) / 1000
    const times = dailyTimes(last, 400)
    const from = monthWindowFromIndex(times, 6)
    const start = times[from]
    expect(start).toBeDefined()
    expect(start! * 1000).toBeGreaterThanOrEqual(Date.UTC(2026, 4, 10))
    expect(start! * 1000).toBeLessThan(Date.UTC(2026, 4, 12))
  })

  it('Agent: a series shorter than the window shows every bar', () => {
    const last = Date.UTC(2026, 10, 10) / 1000
    expect(monthWindowFromIndex(dailyTimes(last, 20), 12)).toBe(0)
    expect(monthWindowFromIndex([], 6)).toBe(0)
  })
})
