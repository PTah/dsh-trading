import { describe, expect, it } from 'vitest'
import type { Kline } from '../src/types.ts'
import { trendSmaStrategy } from '../src/paradigms/trend-sma.ts'
import { applyBotFill, botTradableShare, decideBotBook, moexEquitySession, type BotPosition } from '../src/bot.ts'

function barsFrom(closes: readonly number[]): Kline[] {
  return closes.map((close, index) => ({
    openTime: index * 86_400_000,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  }))
}

/** Длинная база и подъём, который один раз пересекает средние. */
function trendSeries(): { entry: Kline[]; later: Kline[]; exit: Kline[] } {
  const closes: number[] = []
  for (let index = 0; index < 80; index++) closes.push(100)
  for (let index = 0; index < 30; index++) closes.push(100 + index * 1.5)
  const full = barsFrom(closes)
  const signals = trendSmaStrategy.compute(full, { fast: 20, slow: 50 })
  const entry = signals.find(signal => signal.action === 'entry')
  expect(entry).toBeDefined()
  const entryBars = full.slice(0, entry!.index + 1)
  const later = full.slice(0, entry!.index + 12)
  const peak = later[later.length - 1]!.close
  const falling: number[] = later.map(bar => bar.close)
  for (let index = 0; index < 40; index++) falling.push(peak - (index + 1) * 2)
  const fallen = barsFrom(falling)
  const exitSignal = trendSmaStrategy.compute(fallen, { fast: 20, slow: 50 }).find(signal => signal.action === 'exit')
  expect(exitSignal).toBeDefined()
  return { entry: entryBars, later, exit: fallen.slice(0, exitSignal!.index + 1) }
}

describe('MOEX bot book', () => {
  it('Agent: buys a share only on the day the short average crosses above the long one', () => {
    const { entry, later } = trendSeries()
    const fresh = decideBotBook([{ symbol: 'ozon', name: 'Озон', bars: entry }], [])
    expect(fresh.map(row => row.kind)).toEqual(['buy'])
    expect(fresh[0]?.symbol).toBe('ozon')
    expect(fresh[0]?.lots).toBe(1)
    const stale = decideBotBook([{ symbol: 'OZON', bars: later }], [])
    expect(stale).toEqual([])
  })

  it('Agent: sells a held share when the trend breaks and adds once on a pullback to the short average', () => {
    const { entry, exit } = trendSeries()
    const book: BotPosition[] = [{ symbol: 'OZON', lots: 1, adds: 0, entryPrice: 100 }]
    const sold = decideBotBook([{ symbol: 'OZON', bars: exit }], book)
    expect(sold[0]?.kind).toBe('sell')
    expect(sold[0]?.lots).toBe(1)

    const held = entry.slice()
    const last = held[held.length - 1]!
    const closes = held.map(bar => bar.close)
    let fast = 0
    for (let cursor = closes.length - 20; cursor < closes.length; cursor++) fast += closes[cursor] ?? 0
    fast /= 20
    held[held.length - 1] = { ...last, close: fast, high: fast, low: fast, open: fast }
    const added = decideBotBook([{ symbol: 'OZON', bars: held }], book)
    expect(added[0]?.kind).toBe('add')
    const again = decideBotBook([{ symbol: 'OZON', bars: held }], applyBotFill(book, added[0]!))
    expect(again[0]?.kind).toBe('hold')
  })

  it('Agent: skips indexes and OFZ and keeps at most three new buys', () => {
    expect(botTradableShare('IMOEX')).toBe(false)
    expect(botTradableShare('SU29007RMFS0')).toBe(false)
    expect(botTradableShare('OZON')).toBe(true)
    const { entry } = trendSeries()
    const names = ['AAA', 'BBB', 'CCC', 'DDD', 'IMOEX']
    const actions = decideBotBook(names.map(symbol => ({ symbol, bars: entry })), [])
    expect(actions.filter(row => row.kind === 'buy')).toHaveLength(3)
    expect(actions.some(row => row.symbol === 'IMOEX')).toBe(false)
  })

  it('Agent: treats the Moscow equity clock as closed before the main session', () => {
    expect(moexEquitySession(new Date('2026-11-10T04:55:00.000Z'))).toBe('closed')
    expect(moexEquitySession(new Date('2026-11-10T06:55:00.000Z'))).toBe('auction')
    expect(moexEquitySession(new Date('2026-11-10T07:30:00.000Z'))).toBe('trading')
    expect(moexEquitySession(new Date('2026-11-10T15:45:00.000Z'))).toBe('auction')
    expect(moexEquitySession(new Date('2026-11-10T17:00:00.000Z'))).toBe('trading')
    expect(moexEquitySession(new Date('2026-11-14T07:30:00.000Z'))).toBe('closed')
  })
})
