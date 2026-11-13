/**
 * Учебная заявка по акции в том же проходе, что и проверка.
 * Облигации, фонды и шорт сюда не входят. dryRun остаётся у вызывающего моста.
 */
import {
  applyBotFill,
  botTicker,
  type BotPosition,
  type BotReason,
  type BotReview,
  type MoexSession,
} from '@dshtrading/strategies'

export interface BotOrderRequest {
  symbol: string
  side: 'buy' | 'sell'
  quantity: number
}

export interface BotOrderReceipt {
  order?: unknown
  error?: string
}

export interface BotFiling {
  book: BotPosition[]
  reviews: BotReview[]
  orderNote: 'idle' | 'sent' | 'closed' | 'failed'
  sent: number
  due: number
}

function isShareOrder(row: BotReview): row is BotReview & { verdict: 'buy' | 'add' | 'sell'; reason: BotReason } {
  return row.instrument === 'share'
    && (row.verdict === 'buy' || row.verdict === 'add' || row.verdict === 'sell')
    && row.reason !== undefined
    && row.lots > 0
}

export async function fileBotOrders(
  reviews: readonly BotReview[],
  book: readonly BotPosition[],
  session: MoexSession,
  place?: (input: BotOrderRequest) => Promise<BotOrderReceipt>,
): Promise<BotFiling> {
  const orders = reviews.filter(isShareOrder)
  if (orders.length === 0) {
    return { book: [...book], reviews: [...reviews], orderNote: 'idle', sent: 0, due: 0 }
  }
  if (session !== 'trading') {
    return { book: [...book], reviews: [...reviews], orderNote: 'closed', sent: 0, due: orders.length }
  }
  if (place === undefined) {
    return { book: [...book], reviews: [...reviews], orderNote: 'failed', sent: 0, due: orders.length }
  }
  let next = [...book]
  const filled = new Set<string>()
  let sent = 0
  let failed = 0
  for (const action of orders) {
    const side = action.verdict === 'sell' ? 'sell' as const : 'buy' as const
    let receipt: BotOrderReceipt
    try {
      receipt = await place({ symbol: action.symbol, side, quantity: action.lots })
    } catch (err) {
      receipt = { error: err instanceof Error ? err.message : 'rejected' }
    }
    if (receipt.order === undefined) {
      failed += 1
      continue
    }
    next = applyBotFill(next, {
      symbol: action.symbol,
      ...(action.name === undefined ? {} : { name: action.name }),
      kind: action.verdict,
      lots: action.lots,
      price: action.price,
      reason: action.reason,
    })
    filled.add(botTicker(action.symbol))
    sent += 1
  }
  const settled = reviews.flatMap(row => {
    if (!filled.has(botTicker(row.symbol))) return [row]
    if (row.verdict === 'sell') return []
    const position = next.find(item => botTicker(item.symbol) === botTicker(row.symbol))
    return [{
      ...row,
      verdict: 'hold' as const,
      reason: 'hold' as const,
      lots: position?.lots ?? row.lots,
    }]
  })
  return {
    book: next,
    reviews: settled,
    orderNote: sent > 0 ? 'sent' : 'failed',
    sent,
    due: orders.length,
  }
}
