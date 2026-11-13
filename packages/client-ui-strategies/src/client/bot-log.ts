/**
 * Журнал проверок робота. Новая запись сверху.
 * Книга заявок и избранное здесь не пишутся.
 */
export const BOT_LOG_KEY = 'dshtrading.bot.log.v1'
export const BOT_LOG_LIMIT = 80

const HIT_VERDICTS = new Set(['buy', 'add', 'sell', 'bond-add', 'fund-entry'])

export interface BotLogHit {
  symbol: string
  name?: string
  verdict: 'buy' | 'add' | 'sell' | 'bond-add' | 'fund-entry'
}

export interface BotLogMark {
  orderNote: 'sent' | 'closed' | 'failed'
  sent: number
  due: number
}

export interface BotLogEntry {
  at: number
  source: 'manual' | 'auto'
  ok: boolean
  looked: number
  buys: number
  adds: number
  sells: number
  bonds: number
  hits: BotLogHit[]
  /** Нет поля — проверка ничего не записывала. Старые строки журнала так и остаются. */
  orderNote?: BotLogMark['orderNote']
  sent?: number
  due?: number
}

interface ReviewLike {
  symbol: string
  name?: string
  verdict: string
}

export function botLogEntry(
  at: number,
  source: BotLogEntry['source'],
  reviews: readonly ReviewLike[],
  mark?: BotLogMark,
): BotLogEntry {
  const hits: BotLogHit[] = []
  for (const row of reviews) {
    if (!HIT_VERDICTS.has(row.verdict) || row.symbol === '') continue
    hits.push({
      symbol: row.symbol,
      ...(row.name === undefined || row.name === '' ? {} : { name: row.name }),
      verdict: row.verdict as BotLogHit['verdict'],
    })
    if (hits.length === 12) break
  }
  return {
    at,
    source,
    ok: true,
    looked: reviews.length,
    buys: reviews.filter(row => row.verdict === 'buy').length,
    adds: reviews.filter(row => row.verdict === 'add').length,
    sells: reviews.filter(row => row.verdict === 'sell').length,
    bonds: reviews.filter(row => row.verdict === 'bond-add').length,
    hits,
    ...(mark === undefined ? {} : { orderNote: mark.orderNote, sent: mark.sent, due: mark.due }),
  }
}

export function failedBotLogEntry(at: number, source: BotLogEntry['source']): BotLogEntry {
  return { at, source, ok: false, looked: 0, buys: 0, adds: 0, sells: 0, bonds: 0, hits: [] }
}

export function appendBotLog(prev: readonly BotLogEntry[], entry: BotLogEntry, limit = BOT_LOG_LIMIT): BotLogEntry[] {
  return [entry, ...prev].slice(0, limit)
}

function hitOf(value: unknown): BotLogHit | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as { symbol?: unknown; name?: unknown; verdict?: unknown }
  if (typeof row.symbol !== 'string' || row.symbol === '') return null
  if (typeof row.verdict !== 'string' || !HIT_VERDICTS.has(row.verdict)) return null
  return {
    symbol: row.symbol,
    ...(typeof row.name === 'string' && row.name !== '' ? { name: row.name } : {}),
    verdict: row.verdict as BotLogHit['verdict'],
  }
}

export function sanitizeBotLog(raw: unknown): BotLogEntry[] {
  if (!Array.isArray(raw)) return []
  const out: BotLogEntry[] = []
  for (const value of raw) {
    if (typeof value !== 'object' || value === null) continue
    const row = value as Partial<BotLogEntry>
    if (typeof row.at !== 'number' || !Number.isFinite(row.at)) continue
    if (row.source !== 'manual' && row.source !== 'auto') continue
    if (typeof row.ok !== 'boolean') continue
    const hits = Array.isArray(row.hits) ? row.hits.map(hitOf).filter((hit): hit is BotLogHit => hit !== null) : []
    const orderNote = row.orderNote === 'sent' || row.orderNote === 'closed' || row.orderNote === 'failed'
      ? row.orderNote
      : undefined
    out.push({
      at: row.at,
      source: row.source,
      ok: row.ok,
      looked: typeof row.looked === 'number' ? row.looked : 0,
      buys: typeof row.buys === 'number' ? row.buys : 0,
      adds: typeof row.adds === 'number' ? row.adds : 0,
      sells: typeof row.sells === 'number' ? row.sells : 0,
      bonds: typeof row.bonds === 'number' ? row.bonds : 0,
      hits,
      ...(orderNote === undefined ? {} : {
        orderNote,
        sent: typeof row.sent === 'number' ? row.sent : 0,
        due: typeof row.due === 'number' ? row.due : 0,
      }),
    })
    if (out.length === BOT_LOG_LIMIT) break
  }
  return out
}
