import { describe, expect, it } from 'vitest'
import type { BotReview } from '@dshtrading/strategies'
import { holdingViews } from '../src/client/bot-holdings.ts'
import type { BotLogEntry } from '../src/client/bot-log.ts'

const buy: BotReview = {
  symbol: 'BRZL',
  name: 'Бурятзолото',
  instrument: 'share',
  verdict: 'hold',
  lots: 1,
  price: 1204,
  reason: 'hold',
}

describe('bot holdings', () => {
  it('Agent: shows a booked share with its name and the latest price', () => {
    // Given the robot booked BRZL and the last check still holds it
    const log: BotLogEntry[] = [{
      at: 1,
      source: 'manual',
      ok: true,
      looked: 65,
      buys: 1,
      adds: 0,
      sells: 0,
      bonds: 10,
      hits: [{ symbol: 'BRZL', name: 'Бурятзолото', verdict: 'buy' }],
      orderNote: 'sent',
      sent: 1,
      due: 1,
    }]
    // When the table rows are built
    const rows = holdingViews([{ symbol: 'BRZL', lots: 1, adds: 0, entryPrice: 1198 }], [buy], log)
    // Then the booked name, entry and current price are all present
    expect(rows).toEqual([{
      symbol: 'BRZL',
      name: 'Бурятзолото',
      lots: 1,
      entryPrice: 1198,
      price: 1204,
      status: 'hold',
      booked: true,
    }])
  })

  it('Agent: keeps a buy signal visible when it has not entered the book', () => {
    // Given a fresh buy that the book does not contain yet
    const signal: BotReview = { ...buy, verdict: 'buy', reason: 'fresh-cross', price: 1198 }
    // When there is no booked position
    const rows = holdingViews([], [signal], [])
    // Then the signal still has a row, so the count is not the only trace
    expect(rows.map(row => [row.symbol, row.status, row.name])).toEqual([['BRZL', 'buy', 'Бурятзолото']])
  })
})
