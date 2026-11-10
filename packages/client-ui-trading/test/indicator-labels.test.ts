import { describe, expect, it } from 'vitest'
import { ruIndicatorLabel } from '../src/client/indicator-labels.ts'

describe('ruIndicatorLabel', () => {
  it('Agent: maps built-in Chinese indicator chrome to Russian and leaves Latin ids', () => {
    // Given Chinese titles/keys from preset definitions
    // When the chart renders them
    // Then the visible label is Russian and Latin ids stay
    expect(ruIndicatorLabel('成交量')).toBe('Объём')
    expect(ruIndicatorLabel('下跌量')).toBe('Падение')
    expect(ruIndicatorLabel('量比分档量能')).toBe('Объём по отношению')
    expect(ruIndicatorLabel('超级趋势')).toBe('SuperTrend')
    expect(ruIndicatorLabel('周期3')).toBe('Период 3')
    expect(ruIndicatorLabel('MACD')).toBe('MACD')
  })
})
