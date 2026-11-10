/**
 * Книга робота для акций MOEX.
 *
 * Новая покупка — только свежее пересечение SMA20 выше SMA50 на последней
 * закрытой дневной свече. Купленное имя живёт в книге робота, не в избранном:
 * одна докупка у короткой средней, пока тренд цел, и продажа, когда средние
 * снова расходятся вниз или цена уходит под длинную среднюю.
 * Индексы и облигации SU сюда не попадают. Функция ничего не отправляет.
 */
import type { Kline } from './types.ts'
import { trendSmaStrategy } from './paradigms/trend-sma.ts'

export const BOT_FAST = 20
export const BOT_SLOW = 50
export const BOT_MAX_NEW_BUYS = 3
export const BOT_ADD_BAND = 0.015

const INDEXES = new Set(['IMOEX', 'RGBI', 'RTSI', 'MOEX'])

export type BotReason = 'fresh-cross' | 'trend-broken' | 'pullback' | 'hold'
export type BotKind = 'buy' | 'add' | 'sell' | 'hold'

export interface BotPosition {
  symbol: string
  lots: number
  /** 0 = ещё не докупали, 1 = одна докупка уже была. */
  adds: number
  entryPrice: number
}

export interface BotCandidate {
  symbol: string
  name?: string
  bars: readonly Kline[]
}

export interface BotAction {
  symbol: string
  name?: string
  kind: BotKind
  lots: number
  price: number
  reason: BotReason
}

export function botTicker(symbol: string): string {
  return symbol.split('.')[0]?.trim().toUpperCase() ?? ''
}

/** Акция с буквенным тикером. Индекс и облигация SU — нет. */
export function botTradableShare(symbol: string): boolean {
  const ticker = botTicker(symbol)
  if (ticker === '' || INDEXES.has(ticker) || ticker.startsWith('SU')) return false
  return /^[A-Z]{2,6}$/.test(ticker)
}

function smaAt(closes: readonly number[], period: number, index: number): number | undefined {
  if (index + 1 < period) return undefined
  let sum = 0
  for (let cursor = index - period + 1; cursor <= index; cursor++) sum += closes[cursor] ?? 0
  return sum / period
}

function lastOf<T>(rows: readonly T[]): T | undefined {
  return rows.length === 0 ? undefined : rows[rows.length - 1]
}

/**
 * Решения по книге. Новых покупок не больше трёх за один проход,
 * сначала те, у кого короткая средняя сильнее оторвалась от длинной.
 */
export function decideBotBook(
  candidates: readonly BotCandidate[],
  book: readonly BotPosition[],
): BotAction[] {
  const held = new Map(book.map(row => [botTicker(row.symbol), row]))
  const buys: Array<BotAction & { strength: number }> = []
  const rest: BotAction[] = []

  for (const candidate of candidates) {
    if (!botTradableShare(candidate.symbol)) continue
    const bars = candidate.bars
    const last = lastOf(bars)
    if (last === undefined) continue
    const closes = bars.map(bar => bar.close)
    const index = bars.length - 1
    const fast = smaAt(closes, BOT_FAST, index)
    const slow = smaAt(closes, BOT_SLOW, index)
    if (fast === undefined || slow === undefined || slow === 0) continue
    const signals = trendSmaStrategy.compute(bars, { fast: BOT_FAST, slow: BOT_SLOW })
    const signal = lastOf(signals)
    const freshEntry = signal?.action === 'entry' && signal.index === index
    const freshExit = signal?.action === 'exit' && signal.index === index
    const position = held.get(botTicker(candidate.symbol))
    const name = candidate.name

    if (position !== undefined) {
      if (freshExit || last.close < slow) {
        rest.push({
          symbol: candidate.symbol,
          ...(name === undefined ? {} : { name }),
          kind: 'sell',
          lots: position.lots,
          price: last.close,
          reason: 'trend-broken',
        })
        continue
      }
      const nearFast = last.close <= fast * (1 + BOT_ADD_BAND) && last.close >= fast * (1 - BOT_ADD_BAND)
      if (position.adds < 1 && fast > slow && last.close > slow && nearFast) {
        rest.push({
          symbol: candidate.symbol,
          ...(name === undefined ? {} : { name }),
          kind: 'add',
          lots: 1,
          price: last.close,
          reason: 'pullback',
        })
        continue
      }
      rest.push({
        symbol: candidate.symbol,
        ...(name === undefined ? {} : { name }),
        kind: 'hold',
        lots: position.lots,
        price: last.close,
        reason: 'hold',
      })
      continue
    }

    if (freshEntry && last.close > slow) {
      buys.push({
        symbol: candidate.symbol,
        ...(name === undefined ? {} : { name }),
        kind: 'buy',
        lots: 1,
        price: last.close,
        reason: 'fresh-cross',
        strength: (fast - slow) / slow,
      })
    }
  }

  buys.sort((a, b) => b.strength - a.strength)
  const picked = buys.slice(0, BOT_MAX_NEW_BUYS).map(({ strength: _strength, ...action }) => action)
  return [...picked, ...rest]
}

/** Учебная заявка прошла — книга меняется. Повторная покупка того же тикера не плодит строку. */
export function applyBotFill(book: readonly BotPosition[], action: BotAction): BotPosition[] {
  const ticker = botTicker(action.symbol)
  if (action.kind === 'sell') return book.filter(row => botTicker(row.symbol) !== ticker)
  if (action.kind === 'hold') return [...book]
  const existing = book.find(row => botTicker(row.symbol) === ticker)
  if (action.kind === 'buy') {
    if (existing !== undefined) return [...book]
    return [...book, { symbol: ticker, lots: action.lots, adds: 0, entryPrice: action.price }]
  }
  if (existing === undefined) {
    return [...book, { symbol: ticker, lots: action.lots, adds: 1, entryPrice: action.price }]
  }
  return book.map(row => botTicker(row.symbol) === ticker
    ? { ...row, lots: row.lots + action.lots, adds: row.adds + 1 }
    : row)
}

export type MoexSession = 'closed' | 'auction' | 'trading'

/**
 * Будний календарь акций Мосбиржи по часам Москвы.
 * Основная сессия 10:00–18:40, вечерняя 19:00–23:50.
 * Аукционы 09:50–10:00 и 18:40–18:50. Праздники биржи сюда не входят.
 */
export function moexEquitySession(at: Date | number = Date.now()): MoexSession {
  const date = typeof at === 'number' ? new Date(at) : at
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Moscow',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date)
  let weekday = ''
  let hour = 0
  let minute = 0
  for (const part of parts) {
    if (part.type === 'weekday') weekday = part.value
    else if (part.type === 'hour') hour = Number(part.value)
    else if (part.type === 'minute') minute = Number(part.value)
  }
  const day = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[weekday]
  if (day === 0 || day === 6) return 'closed'
  const minutes = hour * 60 + minute
  if (minutes >= 9 * 60 + 50 && minutes < 10 * 60) return 'auction'
  if (minutes >= 10 * 60 && minutes < 18 * 60 + 40) return 'trading'
  if (minutes >= 18 * 60 + 40 && minutes < 18 * 60 + 50) return 'auction'
  if (minutes >= 19 * 60 && minutes < 23 * 60 + 50) return 'trading'
  return 'closed'
}
