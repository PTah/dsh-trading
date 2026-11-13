/**
 * Строки купленных акций для таблицы. Книга — факт учебной заявки.
 * Имя берётся из последней проверки, цена «сейчас» — из её разбора.
 */
import { botTicker, type BotPosition, type BotReview } from '@dshtrading/strategies'
import type { BotLogEntry } from './bot-log.ts'

export type HoldingStatus = 'buy' | 'add' | 'sell' | 'hold' | 'book'

export interface HoldingView {
  symbol: string
  name?: string
  lots: number
  entryPrice: number
  price?: number
  status: HoldingStatus
  booked: boolean
}

function rememberName(names: Map<string, string>, symbol: string, name: string | undefined): void {
  if (name === undefined || name === '') return
  names.set(botTicker(symbol), name)
}

export function holdingViews(
  book: readonly BotPosition[],
  reviews: readonly BotReview[] | null,
  log: readonly BotLogEntry[],
): HoldingView[] {
  const names = new Map<string, string>()
  for (let index = log.length - 1; index >= 0; index -= 1) {
    for (const hit of log[index]?.hits ?? []) rememberName(names, hit.symbol, hit.name)
  }
  for (const row of reviews ?? []) rememberName(names, row.symbol, row.name)
  const reviewBy = new Map((reviews ?? []).map(row => [botTicker(row.symbol), row]))
  const rows: HoldingView[] = book.map(position => {
    const symbol = botTicker(position.symbol)
    const review = reviewBy.get(symbol)
    const live = review?.verdict
    const status: HoldingStatus = live === 'buy' || live === 'add' || live === 'sell' || live === 'hold' ? live : 'book'
    const name = names.get(symbol)
    return {
      symbol,
      ...(name === undefined ? {} : { name }),
      lots: position.lots,
      entryPrice: position.entryPrice,
      ...(review !== undefined && review.price > 0 ? { price: review.price } : {}),
      status,
      booked: true,
    }
  })
  const held = new Set(rows.map(row => row.symbol))
  for (const review of reviews ?? []) {
    if (review.instrument !== 'share') continue
    if (review.verdict !== 'buy' && review.verdict !== 'add' && review.verdict !== 'sell') continue
    const symbol = botTicker(review.symbol)
    if (held.has(symbol)) continue
    const name = names.get(symbol)
    rows.push({
      symbol,
      ...(name === undefined ? {} : { name }),
      lots: review.lots,
      entryPrice: 0,
      ...(review.price > 0 ? { price: review.price } : {}),
      status: review.verdict,
      booked: false,
    })
  }
  return rows
}
