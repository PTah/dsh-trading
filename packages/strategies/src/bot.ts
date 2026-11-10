/**
 * Книга робота для акций MOEX.
 *
 * Новая покупка — только свежее пересечение SMA20 выше SMA50 на последней
 * закрытой дневной свече. Купленное имя живёт в книге робота, не в избранном:
 * одна докупка у короткой средней, пока тренд цел, и продажа, когда средние
 * снова расходятся вниз или цена уходит под длинную среднюю.
 * Индексы в покупку не попадают. ОФЗ и прочие облигации не получают заявку:
 * по ним остаётся рекомендация к номиналу. Короткую продажу функция не предлагает.
 */
import type { Kline } from './types.ts'
import { trendSmaStrategy } from './paradigms/trend-sma.ts'

export const BOT_FAST = 20
export const BOT_SLOW = 50
export const BOT_MAX_NEW_BUYS = 3
export const BOT_ADD_BAND = 0.015
export const BOT_PEAK_LOOKBACK = 60
export const BOT_PEAK_NEAR = 0.05
export const BOT_BOND_DISCOUNT = 98
export const BOT_BOND_PREMIUM = 102

const INDEXES = new Set(['IMOEX', 'RGBI', 'RTSI', 'MOEX'])
const CASH_FUNDS = new Set(['LQDT', 'SBMM', 'AKMM', 'TMON'])

export type BotInstrument = 'share' | 'equity-fund' | 'bond-fund' | 'cash-fund' | 'ofz' | 'bond'

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
  instrument?: BotInstrument
}

export interface BotAction {
  symbol: string
  name?: string
  kind: BotKind
  lots: number
  price: number
  reason: BotReason
}

/** Что проверка говорит по каждой просмотренной акции, включая отказ от покупки. */
export type BotVerdict = BotKind | 'no-cross' | 'short-history' | 'no-bars' | 'passed-over' | 'rising' | 'no-short' | 'fund-entry' | 'cash-skip' | 'bond-add' | 'bond-discount' | 'bond-rich' | 'bond-hold' | 'bond-fund-down' | 'bond-fund-flat'

export interface BotReview {
  symbol: string
  name?: string
  instrument: BotInstrument
  verdict: BotVerdict
  lots: number
  price: number
  /** Изменение цены за пять дневных свечей. Для облигации это пункты номинала. */
  move?: number
  reason?: BotReason
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

/** Класс бумаги для ежедневной проверки. Заявка дальше разрешена только для share. */
export function classifyBotInstrument(input: { symbol: string; listing?: string; name?: string }): BotInstrument {
  const ticker = botTicker(input.symbol)
  const name = (input.name ?? '').toLowerCase()
  if (input.listing === 'bond' || ticker.startsWith('SU')) return ticker.startsWith('SU') ? 'ofz' : 'bond'
  if (input.listing === 'fund' || CASH_FUNDS.has(ticker)) {
    if (CASH_FUNDS.has(ticker) || /денеж|ликвид/.test(name)) return 'cash-fund'
    if (/облигац|офз/.test(name)) return 'bond-fund'
    return 'equity-fund'
  }
  return 'share'
}

/** Фонды FinEx числятся в справочнике Мосбиржи, дневных свечей по ним нет. */
export function botDormantFund(input: { symbol: string; name?: string }): boolean {
  const ticker = botTicker(input.symbol)
  const name = (input.name ?? '').toLowerCase()
  return ticker.startsWith('FX') || name.includes('finex')
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

interface BotDraft extends BotReview {
  strength: number
}

function named(symbol: string, name: string | undefined): { symbol: string; name?: string } {
  return name === undefined ? { symbol } : { symbol, name }
}

function fiveDayMove(closes: readonly number[], index: number): number | undefined {
  const previous = closes[index - 5]
  const current = closes[index]
  if (previous === undefined || current === undefined) return undefined
  return current - previous
}

function trailingHigh(closes: readonly number[], index: number, lookback: number): number | undefined {
  if (index + 1 < lookback) return undefined
  let high = -Infinity
  for (let cursor = index - lookback + 1; cursor <= index; cursor++) {
    const close = closes[cursor]
    if (close === undefined || !Number.isFinite(close)) return undefined
    if (close > high) high = close
  }
  return high > 0 ? high : undefined
}

function quietStance(closes: readonly number[], index: number, fast: number, slow: number, close: number): BotVerdict {
  const high = trailingHigh(closes, index, BOT_PEAK_LOOKBACK)
  if (high !== undefined && fast > slow && close > slow && (high - close) / high <= BOT_PEAK_NEAR) return 'rising'
  if (close < slow) return 'no-short'
  return 'no-cross'
}

/**
 * Разбор каждой просмотренной акции. Новых покупок не больше трёх,
 * сначала те, у кого короткая средняя сильнее оторвалась от длинной.
 * Остальные остаются в списке с причиной, почему покупки нет.
 */
export function reviewBotBook(
  candidates: readonly BotCandidate[],
  book: readonly BotPosition[],
): BotReview[] {
  const held = new Map(book.map(row => [botTicker(row.symbol), row]))
  const buys: BotDraft[] = []
  const rest: BotDraft[] = []
  const quiet: BotDraft[] = []

  for (const candidate of candidates) {
    const instrument = candidate.instrument ?? 'share'
    if (instrument === 'share' && !botTradableShare(candidate.symbol)) continue
    const name = candidate.name
    const base = { ...named(candidate.symbol, name), instrument, lots: 0, strength: 0 }
    const bars = candidate.bars
    const last = lastOf(bars)
    if (last === undefined) {
      quiet.push({ ...base, verdict: 'no-bars', price: 0 })
      continue
    }
    const closes = bars.map(bar => bar.close)
    const index = bars.length - 1
    const move = fiveDayMove(closes, index)

    if (instrument === 'cash-fund') {
      quiet.push({ ...base, verdict: 'cash-skip', price: last.close, ...(move === undefined ? {} : { move }) })
      continue
    }
    if (instrument === 'ofz' || instrument === 'bond') {
      if (index < 5) {
        quiet.push({ ...base, verdict: 'short-history', price: last.close })
        continue
      }
      const verdict: BotVerdict = last.close < BOT_BOND_DISCOUNT && (move ?? 0) < 0
        ? 'bond-add'
        : last.close < BOT_BOND_DISCOUNT
          ? 'bond-discount'
          : last.close > BOT_BOND_PREMIUM
            ? 'bond-rich'
            : 'bond-hold'
      quiet.push({ ...base, verdict, price: last.close, ...(move === undefined ? {} : { move }) })
      continue
    }
    if (instrument === 'bond-fund') {
      if (move === undefined) {
        quiet.push({ ...base, verdict: 'short-history', price: last.close })
        continue
      }
      quiet.push({ ...base, verdict: move < 0 ? 'bond-fund-down' : 'bond-fund-flat', price: last.close, move })
      continue
    }

    const fast = smaAt(closes, BOT_FAST, index)
    const slow = smaAt(closes, BOT_SLOW, index)
    if (fast === undefined || slow === undefined || slow === 0) {
      quiet.push({ ...base, verdict: 'short-history', price: last.close })
      continue
    }
    const signals = trendSmaStrategy.compute(bars, { fast: BOT_FAST, slow: BOT_SLOW })
    const signal = lastOf(signals)
    const freshEntry = signal?.action === 'entry' && signal.index === index
    const freshExit = signal?.action === 'exit' && signal.index === index
    const position = instrument === 'share' ? held.get(botTicker(candidate.symbol)) : undefined

    if (position !== undefined) {
      if (freshExit || last.close < slow) {
        rest.push({
          ...base,
          verdict: 'sell',
          lots: position.lots,
          price: last.close,
          reason: 'trend-broken',
        })
        continue
      }
      const nearFast = last.close <= fast * (1 + BOT_ADD_BAND) && last.close >= fast * (1 - BOT_ADD_BAND)
      if (position.adds < 1 && fast > slow && last.close > slow && nearFast) {
        rest.push({
          ...base,
          verdict: 'add',
          lots: 1,
          price: last.close,
          reason: 'pullback',
        })
        continue
      }
      rest.push({
        ...base,
        verdict: 'hold',
        lots: position.lots,
        price: last.close,
        reason: 'hold',
      })
      continue
    }

    if (freshEntry && last.close > slow) {
      if (instrument === 'equity-fund') {
        quiet.push({ ...base, verdict: 'fund-entry', price: last.close, ...(move === undefined ? {} : { move }) })
        continue
      }
      buys.push({
        ...base,
        verdict: 'buy',
        lots: 1,
        price: last.close,
        reason: 'fresh-cross',
        strength: (fast - slow) / slow,
      })
      continue
    }
    quiet.push({
      ...base,
      verdict: quietStance(closes, index, fast, slow, last.close),
      price: last.close,
      ...(move === undefined ? {} : { move }),
    })
  }

  buys.sort((a, b) => b.strength - a.strength)
  const picked = buys.slice(0, BOT_MAX_NEW_BUYS)
  const passed = buys.slice(BOT_MAX_NEW_BUYS).map(row => ({ ...row, verdict: 'passed-over' as const }))
  return [...picked, ...rest, ...passed, ...quiet].map(({ strength: _strength, ...review }) => review)
}

/** Решения, по которым можно отправить учебную заявку или оставить позицию. */
export function decideBotBook(
  candidates: readonly BotCandidate[],
  book: readonly BotPosition[],
): BotAction[] {
  return reviewBotBook(candidates, book).flatMap(row => {
    if (row.instrument !== 'share') return []
    if (row.verdict !== 'buy' && row.verdict !== 'add' && row.verdict !== 'sell' && row.verdict !== 'hold') return []
    if (row.reason === undefined) return []
    return [{
      ...named(row.symbol, row.name),
      kind: row.verdict,
      lots: row.lots,
      price: row.price,
      reason: row.reason,
    }]
  })
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

export interface BondCashStep {
  /** Полных лет от сегодня. Последняя строка — фактический срок до погашения. */
  years: number
  coupons: number
  /** true только в строке погашения: тут возвращается номинал. */
  redeemed: boolean
  /** Купоны к этой дате. В строке погашения ещё номинал минус уплаченная грязная цена. */
  result: number
}

/**
 * Расклад удержания облигации. До погашения в результат входят только купоны:
 * продажа раньше срока идёт по неизвестной рыночной цене, не по номиналу.
 */
export function bondCashLadder(input: {
  at: number
  maturity: string
  nominal: number
  dirty: number
  couponPay: number
  couponsPerYear: number
}, maxYears = 12): BondCashStep[] {
  const maturityMs = Date.parse(input.maturity)
  if (!Number.isFinite(maturityMs) || !(input.nominal > 0) || !(input.dirty > 0)) return []
  const yearsLeft = (maturityMs - input.at) / (365.25 * 24 * 60 * 60 * 1000)
  if (!(yearsLeft > 0)) return []
  const annual = input.couponPay > 0 && input.couponsPerYear > 0 ? input.couponPay * input.couponsPerYear : 0
  const full = Math.floor(yearsLeft)
  const steps: BondCashStep[] = []
  for (let year = 1; year <= Math.min(full, maxYears); year += 1) {
    if (yearsLeft - year < 0.05) break
    const coupons = annual * year
    steps.push({ years: year, coupons, redeemed: false, result: coupons })
  }
  const coupons = annual * yearsLeft
  steps.push({
    years: Math.round(yearsLeft * 10) / 10,
    coupons,
    redeemed: true,
    result: coupons + input.nominal - input.dirty,
  })
  return steps
}

export type MoexSession = 'closed' | 'auction' | 'trading'

interface MoscowWall {
  year: number
  month: number
  day: number
  weekday: number
  minutes: number
}

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

function moscowWall(date: Date): MoscowWall {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const pick = (type: string): string => parts.find(part => part.type === type)?.value ?? ''
  const hour = Number(pick('hour'))
  const minute = Number(pick('minute'))
  return {
    year: Number(pick('year')),
    month: Number(pick('month')),
    day: Number(pick('day')),
    weekday: WEEKDAY[pick('weekday')] ?? 0,
    minutes: (hour === 24 ? 0 : hour) * 60 + minute,
  }
}

function offsetMs(timeZone: string, instant: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant))
  const pick = (type: string): number => Number(parts.find(part => part.type === type)?.value ?? '0')
  const hour = pick('hour')
  const asUtc = Date.UTC(pick('year'), pick('month') - 1, pick('day'), hour === 24 ? 0 : hour, pick('minute'), pick('second'))
  return asUtc - instant
}

function moscowWallToUtc(year: number, month: number, day: number, hour: number, minute: number): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute)
  const first = offsetMs('Europe/Moscow', guess)
  const instant = guess - first
  const second = offsetMs('Europe/Moscow', instant)
  return new Date(second === first ? instant : guess - second)
}

/**
 * Будний календарь акций Мосбиржи по часам Москвы.
 * Основная сессия 10:00–18:40, вечерняя 19:00–23:50.
 * Аукционы 09:50–10:00 и 18:40–18:50. Праздники биржи сюда не входят.
 */
export function moexEquitySession(at: Date | number = Date.now()): MoexSession {
  const date = typeof at === 'number' ? new Date(at) : at
  const { weekday, minutes } = moscowWall(date)
  if (weekday === 0 || weekday === 6) return 'closed'
  if (minutes >= 9 * 60 + 50 && minutes < 10 * 60) return 'auction'
  if (minutes >= 10 * 60 && minutes < 18 * 60 + 40) return 'trading'
  if (minutes >= 18 * 60 + 40 && minutes < 18 * 60 + 50) return 'auction'
  if (minutes >= 19 * 60 && minutes < 23 * 60 + 50) return 'trading'
  return 'closed'
}

/** Ближайшее 10:00 или 19:00 мск, когда снова можно торговать. Момент абсолютный. */
export function moexNextTradingOpen(at: Date | number = Date.now()): Date {
  const date = typeof at === 'number' ? new Date(at) : at
  const wall = moscowWall(date)
  const weekend = wall.weekday === 0 || wall.weekday === 6
  let addDays = 0
  let openHour = 10
  if (weekend) {
    addDays = wall.weekday === 6 ? 2 : 1
  } else if (wall.minutes < 10 * 60) {
    openHour = 10
  } else if (wall.minutes < 19 * 60) {
    openHour = 19
  } else {
    addDays = wall.weekday === 5 ? 3 : 1
  }
  const noon = moscowWallToUtc(wall.year, wall.month, wall.day, 12, 0)
  const shifted = moscowWall(new Date(noon.getTime() + addDays * 86_400_000))
  return moscowWallToUtc(shifted.year, shifted.month, shifted.day, openHour, 0)
}
