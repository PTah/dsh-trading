import { describe, expect, it } from 'vitest'
import {
  evaluateOrderGate,
  numberToQuotation,
  normalizeRuSymbol,
  quotationToNumber,
  RU_LIQUID_SHARES,
  ruLiquidInstruments,
  type Config,
} from '../src/index.js'
import {
  INTERVAL_MAX_WINDOW_MS,
  bondQuoteFromParts,
  moexRowsFromInstruments,
  TBankRestClient,
  TradingServiceError,
} from '../src/rest.js'

describe('T-Bank RU liquid universe', () => {
  it('Agent: exposes a unique MOEX share list for the screener', () => {
    // Given the curated liquid list
    const symbols = RU_LIQUID_SHARES.map((row) => row.symbol)
    // When the connector publishes instruments
    const listed = ruLiquidInstruments()
    // Then SBER is present and symbols do not repeat
    expect(symbols).toContain('SBER')
    expect(new Set(symbols).size).toBe(symbols.length)
    expect(listed).toHaveLength(symbols.length)
    expect(listed[0]?.assetClass).toBe('equity')
    expect(listed[0]?.listing).toBe('share')
  })
})

describe('T-Bank MOEX catalog boards', () => {
  it('Agent: keeps tradable TQBR shares and drops other boards', async () => {
    // Given a Shares payload that mixes the main board with a foreign board
    const rows = moexRowsFromInstruments([
      { ticker: 'sber', classCode: 'TQBR', name: 'Сбербанк', apiTradeAvailableFlag: true },
      { ticker: 'AAPL', classCode: 'SPBXM', name: 'Apple', apiTradeAvailableFlag: true },
      { ticker: 'GAZP', classCode: 'TQBR', name: 'Газпром', apiTradeAvailableFlag: false },
    ], 'share')
    // Then only the tradable main-board share remains
    expect(rows.map((row) => row.symbol)).toEqual(['SBER'])
    expect(rows[0]?.listing).toBe('share')
  })

  it('Agent: turns a bond percent price and NKD into the cash paid at purchase', () => {
    // Given a 96.5% quote on a 1000 face and 18.4 of accrued coupon
    const quote = bondQuoteFromParts(96.5, 1000, 18.4)
    // Then the buyer pays the clean price plus NKD
    expect(quote?.clean).toBeCloseTo(965, 6)
    expect(quote?.dirty).toBeCloseTo(983.4, 6)
  })
})

describe('T-Bank quotation helpers', () => {
  it('Agent: converts Quotation units+nano to number', () => {
    // Given: units=270, nano=500_000_000
    expect(quotationToNumber({ units: '270', nano: 500_000_000 })).toBeCloseTo(270.5, 9)
  })

  it('Agent: round-trips numberToQuotation', () => {
    // Given: 123.456789
    const q = numberToQuotation(123.456789)
    expect(quotationToNumber(q)).toBeCloseTo(123.456789, 6)
  })
})

describe('T-Bank symbol vocabulary', () => {
  it('Agent: accepts TICKER and TICKER.CLASSCODE', () => {
    // Given / When / Then
    expect(normalizeRuSymbol('sber')).toBe('SBER')
    expect(normalizeRuSymbol('SBER.TQBR')).toBe('SBER.TQBR')
  })

  it('Agent: rejects malformed symbols', () => {
    // Given / When / Then
    expect(() => normalizeRuSymbol('sber!')).toThrow(TradingServiceError)
  })
})

describe('T-Bank order gate', () => {
  const base: Config = {
    enabled: true,
    env: 'demo',
    dryRun: true,
    liveTrading: false,
    tokenRef: 'TBANK_TOKEN',
    demoTokenRef: 'TBANK_DEMO_TOKEN',
    accountId: '',
  }

  it('Agent: defaults to simulate when dryRun omitted', () => {
    // Given / When / Then
    expect(evaluateOrderGate(base, {
      symbol: 'SBER',
      side: 'BUY',
      type: 'MARKET',
      quantity: 10,
    }).action).toBe('simulate')
  })

  it('Agent: rejects live when authority off', () => {
    // Given / When
    const verdict = evaluateOrderGate(base, {
      symbol: 'SBER',
      side: 'BUY',
      type: 'MARKET',
      quantity: 10,
      dryRun: false,
    })
    // Then
    expect(verdict.action).toBe('reject')
  })
})

describe('T-Bank getKlines windowing', () => {
  it('Agent: pages GetCandles so each request stays within the official max window', async () => {
    // Given: GUI asks for 750 daily bars (> 1y single-window cap → would 30014 without paging)
    const candleCalls: Array<{ from: string; to: string }> = []
    const dayMs = 24 * 60 * 60_000
    const fetchImpl: typeof fetch = async (_input, init) => {
      const url = String(_input)
      const body = JSON.parse(String(init?.body ?? '{}')) as { from?: string; to?: string; query?: string }
      if (url.includes('FindInstrument')) {
        return new Response(JSON.stringify({
          instruments: [{
            ticker: 'SBER',
            classCode: 'TQBR',
            figi: 'BBG004730N88',
            uid: 'e6123145-9665-43e0-8413-cd61b8aa9b13',
            name: 'Sber',
            instrumentKind: 'INSTRUMENT_TYPE_SHARE',
            apiTradeAvailableFlag: true,
          }],
        }), { status: 200 })
      }
      if (url.includes('GetInstrumentBy')) {
        return new Response(JSON.stringify({ instrument: { lot: 10, name: 'Sber', currency: 'rub' } }), { status: 200 })
      }
      if (url.includes('GetCandles')) {
        candleCalls.push({ from: String(body.from), to: String(body.to) })
        const from = Date.parse(String(body.from))
        const to = Date.parse(String(body.to))
        const candles = []
        for (let t = from; t < to; t += dayMs) {
          candles.push({
            time: new Date(t).toISOString(),
            open: { units: '100', nano: 0 },
            high: { units: '101', nano: 0 },
            low: { units: '99', nano: 0 },
            close: { units: '100', nano: 0 },
            volume: '1',
          })
        }
        return new Response(JSON.stringify({ candles }), { status: 200 })
      }
      return new Response(JSON.stringify({ message: `unexpected ${url}` }), { status: 500 })
    }

    const client = new TBankRestClient({ fetchImpl, env: 'demo' })

    // When
    const bars = await client.getKlines('SBER', '1d', 750, { token: 'test-token' })

    // Then: every upstream window ≤ official day cap; response uses openTime and fills depth
    expect(candleCalls.length).toBeGreaterThan(1)
    const maxWindow = INTERVAL_MAX_WINDOW_MS['1d']
    for (const call of candleCalls) {
      expect(Date.parse(call.to) - Date.parse(call.from)).toBeLessThanOrEqual(maxWindow)
    }
    expect(bars.length).toBe(750)
    expect(bars[0]?.openTime).toBeTypeOf('number')
    expect(bars[0]?.closeTime).toBe((bars[0]?.openTime ?? 0) + dayMs - 1)
    expect(bars.at(-1)?.openTime).toBeGreaterThan(bars[0]?.openTime ?? 0)
  })
})
