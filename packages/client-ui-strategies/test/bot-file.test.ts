import { describe, expect, it } from 'vitest'
import type { BotPosition, BotReview } from '@dshtrading/strategies'
import { fileBotOrders } from '../src/client/bot-file.ts'
import { botLogEntry, sanitizeBotLog } from '../src/client/bot-log.ts'

const buy: BotReview = {
  symbol: 'BRZL',
  name: 'Бурятзолото',
  instrument: 'share',
  verdict: 'buy',
  lots: 1,
  price: 812,
  reason: 'fresh-cross',
}

const bond: BotReview = {
  symbol: 'SU26218RMFS',
  name: 'ОФЗ 26218',
  instrument: 'ofz',
  verdict: 'bond-add',
  lots: 0,
  price: 72.4,
}

describe('bot file', () => {
  it('Agent: writes a simulated share buy into the book and leaves the bond alone', async () => {
    // Given one fresh share cross and one bond note, with the exchange open
    const placed: Array<{ symbol: string; side: string; quantity: number }> = []
    // When the check files its own orders
    const filed = await fileBotOrders([buy, bond], [], 'trading', async (input) => {
      placed.push(input)
      return { order: { id: 'dry-brzl' } }
    })
    // Then the book holds the share, the bond was not ordered, and the share is now a hold
    expect(placed).toEqual([{ symbol: 'BRZL', side: 'buy', quantity: 1 }])
    expect(filed.orderNote).toBe('sent')
    expect(filed.sent).toBe(1)
    expect(filed.due).toBe(1)
    expect(filed.book).toEqual([{ symbol: 'BRZL', lots: 1, adds: 0, entryPrice: 812 }])
    expect(filed.reviews.map(row => [row.symbol, row.verdict])).toEqual([
      ['BRZL', 'hold'],
      ['SU26218RMFS', 'bond-add'],
    ])
  })

  it('Agent: sells the whole book line when the trend breaks', async () => {
    // Given the robot already holds BRZL and the review says sell
    const held: BotPosition[] = [{ symbol: 'BRZL', lots: 1, adds: 0, entryPrice: 812 }]
    const sell: BotReview = { ...buy, verdict: 'sell', reason: 'trend-broken', lots: 1 }
    // When the exchange is open and the receipt is accepted
    const filed = await fileBotOrders([sell], held, 'trading', async () => ({ order: { id: 'dry-sell' } }))
    // Then the book line is gone and the list no longer offers that sale
    expect(filed.book).toEqual([])
    expect(filed.reviews).toEqual([])
    expect(filed.orderNote).toBe('sent')
  })

  it('Agent: keeps the signal and does not call the bridge while the exchange is closed', async () => {
    // Given a buy signal outside the trading session
    let called = 0
    // When filing is attempted
    const filed = await fileBotOrders([buy], [], 'closed', async () => {
      called += 1
      return { order: { id: 'nope' } }
    })
    // Then nothing is sent and the buy stays on the list
    expect(called).toBe(0)
    expect(filed.orderNote).toBe('closed')
    expect(filed.book).toEqual([])
    expect(filed.reviews[0]?.verdict).toBe('buy')
  })

  it('Agent: does not pretend the exchange is closed when the order bridge is missing', async () => {
    // Given a buy signal while the exchange is open and no order bridge is wired
    // When filing runs
    const filed = await fileBotOrders([buy], [], 'trading', undefined)
    // Then the buy stays and the result is a failed send, not a closed session
    expect(filed.orderNote).toBe('failed')
    expect(filed.book).toEqual([])
    expect(filed.reviews[0]?.verdict).toBe('buy')
  })

  it('Agent: leaves the buy in place when the receipt is rejected', async () => {
    // Given an open session and a bridge that rejects the order
    // When filing runs
    const filed = await fileBotOrders([buy], [], 'trading', async () => ({ error: 'rejected' }))
    // Then the book stays empty and the buy can be retried
    expect(filed.orderNote).toBe('failed')
    expect(filed.sent).toBe(0)
    expect(filed.book).toEqual([])
    expect(filed.reviews[0]?.verdict).toBe('buy')
  })

  it('Agent: keeps the filing mark on a reloaded journal row', () => {
    // Given a check that filed one simulated order
    const entry = botLogEntry(1_000, 'auto', [buy, bond], { orderNote: 'sent', sent: 1, due: 1 })
    // When the journal is read back
    const saved = sanitizeBotLog([entry, { at: 'вчера', source: 'auto', ok: true }])
    // Then the mark and the share name survive, and the corrupt row is dropped
    expect(saved).toEqual([entry])
    expect(saved[0]?.hits[0]?.symbol).toBe('BRZL')
    expect(saved[0]?.orderNote).toBe('sent')
  })
})
