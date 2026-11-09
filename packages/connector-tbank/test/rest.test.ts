import { describe, expect, it } from 'vitest'
import {
  evaluateOrderGate,
  numberToQuotation,
  normalizeRuSymbol,
  quotationToNumber,
  type Config,
} from '../src/index.js'
import { TradingServiceError } from '../src/rest.js'

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
