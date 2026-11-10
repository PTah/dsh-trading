import { describe, expect, it } from 'vitest'
import type { MarketLocaleKey } from '../src/client/contract.ts'
import { formatMaturity, quoteAboutLine } from '../src/client/quote-about.ts'

const t = (key: MarketLocaleKey, params?: Record<string, unknown>): string => {
  if (params === undefined) return key
  return `${key}:${Object.entries(params).map(([name, value]) => `${name}=${String(value)}`).join(',')}`
}

describe('quote about line', () => {
  it('Agent: explains an OFZ by the loan kind, maturity and coupon count', () => {
    expect(formatMaturity('2034-03-12T00:00:00Z')).toBe('12.03.2034')
    const line = quoteAboutLine({
      listing: 'bond',
      ofz: true,
      maturity: '2034-03-12T00:00:00Z',
      couponsPerYear: 2,
    }, t)
    expect(line).toBe('quote.kind.ofz, quote.bond.maturity:date=12.03.2034, quote.bond.coupon:n=2')
  })

  it('Agent: calls VK-like shares an IT stock instead of repeating the ticker', () => {
    expect(quoteAboutLine({ listing: 'share', sector: 'SECTOR_IT' }, t)).toBe('quote.share.sector:sector=quote.sector.it')
    expect(quoteAboutLine({ listing: 'bond', ofz: false }, t)).toBe('quote.kind.corpBond')
    expect(quoteAboutLine({ listing: 'fund', focus: 'FOCUS_TYPE_EQUITY' }, t)).toBe('quote.kind.fund, quote.fund.equity')
  })
})
