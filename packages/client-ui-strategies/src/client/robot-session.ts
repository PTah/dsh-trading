/**
 * Проверка робота живёт в модуле плагина, не в панели вкладки.
 * Смена вкладки размонтирует панель, таймер остаётся.
 */
import {
  bondCashLadder,
  botDormantFund,
  botTradableShare,
  classifyBotInstrument,
  moexEquitySession,
  reviewBotBook,
  type BondCashStep,
  type BotPosition,
  type BotReview,
} from '@dshtrading/strategies'
import { fileBotOrders } from './bot-file.ts'
import { appendBotLog, BOT_LOG_KEY, botLogEntry, failedBotLogEntry, sanitizeBotLog, type BotLogEntry, type BotLogMark } from './bot-log.ts'
import { readJson, writeJson } from './shell-faces.ts'

const BOOK_KEY = 'dshtrading.bot.book.v1'

const WATCH_MS = 30 * 60 * 1000
const SHARE_LIMIT = 30
const FUND_LIMIT = 20
const OFZ_LIMIT = 20
const BOND_LIMIT = 15
const CONCURRENCY = 4

interface KlineWire {
  openTime: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface RobotBridge {
  fetchKlines: (market: string, symbol: string, interval: string, limit: number) => Promise<KlineWire[]>
  fetchSymbols: (market: string) => Promise<Array<{ symbol: string; name?: string; listing?: string }>>
  placeBotDryRunOrder?: (input: { symbol: string; side: 'buy' | 'sell'; quantity: number }) => Promise<{ order?: unknown; error?: string }>
  fetchTickers?: (market: string, symbols: string[]) => Promise<Record<string, {
    ok?: boolean
    ticker?: {
      bond?: {
        nominal: number
        aci: number
        pricePercent: number
        clean: number
        dirty: number
        couponPay?: number
        maturity?: string
        couponsPerYear?: number
      }
    }
  }>>
}

export interface BondLadder {
  steps: BondCashStep[]
  couponsKnown: boolean
}

export interface RobotSnap {
  reviews: BotReview[] | null
  book: BotPosition[]
  ladders: Record<string, BondLadder>
  skippedFunds: number
  watching: boolean
  busy: boolean
  failed: boolean
  checkedAt: number | null
  log: BotLogEntry[]
}

function loadBook(): BotPosition[] {
  const raw = readJson<BotPosition[]>(BOOK_KEY, [])
  return Array.isArray(raw) ? raw.filter(row => typeof row?.symbol === 'string' && row.symbol !== '') : []
}

const listeners = new Set<() => void>()
let book: BotPosition[] = loadBook()
let snap: RobotSnap = {
  reviews: null,
  book,
  ladders: {},
  skippedFunds: 0,
  watching: false,
  busy: false,
  failed: false,
  checkedAt: null,
  log: sanitizeBotLog(readJson<unknown>(BOT_LOG_KEY, [])),
}
let bridge: RobotBridge | null = null
let timer: ReturnType<typeof setInterval> | null = null
let gate = false

function emit(): void {
  for (const listener of listeners) listener()
}

function patch(partial: Partial<RobotSnap>): void {
  snap = { ...snap, ...partial }
  emit()
}

function remember(entry: BotLogEntry): BotLogEntry[] {
  const log = appendBotLog(snap.log, entry)
  writeJson(BOT_LOG_KEY, log)
  return log
}

function keepBook(next: BotPosition[], sent: number): void {
  book = next
  if (sent > 0) writeJson(BOOK_KEY, next)
}

async function fileHeld(
  reviews: readonly BotReview[],
  source: RobotBridge,
): Promise<{ reviews: BotReview[]; mark: BotLogMark | undefined }> {
  const filed = await fileBotOrders(reviews, book, moexEquitySession(), source.placeBotDryRunOrder)
  keepBook(filed.book, filed.sent)
  const mark = filed.orderNote === 'idle' ? undefined : { orderNote: filed.orderNote, sent: filed.sent, due: filed.due }
  return { reviews: filed.reviews, mark }
}

async function mapPool<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      out[index] = await run(items[index] as T)
    }
  })
  await Promise.all(workers)
  return out
}

async function laddersFor(source: RobotBridge, reviews: readonly BotReview[]): Promise<Record<string, BondLadder>> {
  if (source.fetchTickers === undefined) return {}
  const symbols = reviews.filter(row => row.verdict === 'bond-add').map(row => row.symbol)
  if (symbols.length === 0) return {}
  try {
    const rows = await source.fetchTickers('ru', symbols)
    const out: Record<string, BondLadder> = {}
    for (const symbol of symbols) {
      const bond = rows[symbol]?.ticker?.bond
      if (bond?.maturity === undefined) continue
      const couponPay = bond.couponPay ?? 0
      out[symbol] = {
        couponsKnown: (bond.couponPay ?? 0) > 0 && (bond.couponsPerYear ?? 0) > 0,
        steps: bondCashLadder({
          at: Date.now(),
          maturity: bond.maturity,
          nominal: bond.nominal,
          dirty: bond.dirty,
          couponPay,
          couponsPerYear: bond.couponsPerYear ?? 0,
        }),
      }
    }
    return out
  } catch {
    return {}
  }
}

async function run(source: RobotBridge, held: readonly BotPosition[], sourceKind: BotLogEntry['source']): Promise<void> {
  if (snap.busy || gate) return
  gate = true
  patch({ busy: true, failed: false })
  try {
    const symbols = await source.fetchSymbols('ru')
    const tagged = symbols.map(row => ({ ...row, instrument: classifyBotInstrument(row) }))
    const shares = tagged.filter(row => row.instrument === 'share' && botTradableShare(row.symbol)).slice(0, SHARE_LIMIT)
    const dormant = tagged.filter(row => (row.instrument === 'equity-fund' || row.instrument === 'bond-fund' || row.instrument === 'cash-fund') && botDormantFund(row))
    const funds = tagged.filter(row => (row.instrument === 'equity-fund' || row.instrument === 'bond-fund' || row.instrument === 'cash-fund') && !botDormantFund(row)).slice(0, FUND_LIMIT)
    const ofz = tagged.filter(row => row.instrument === 'ofz').slice(0, OFZ_LIMIT)
    const bonds = tagged.filter(row => row.instrument === 'bond').slice(0, BOND_LIMIT)
    const extra = held.filter(row => !shares.some(share => share.symbol.toUpperCase() === row.symbol.toUpperCase()))
    const queue = [
      ...shares,
      ...extra.map(row => ({ symbol: row.symbol, name: row.symbol, instrument: 'share' as const })),
      ...funds,
      ...ofz,
      ...bonds,
    ]
    const candidates = await mapPool(queue, CONCURRENCY, async (row) => {
      try {
        const bars = await source.fetchKlines('ru', row.symbol, '1d', 120)
        return {
          symbol: row.symbol,
          instrument: row.instrument,
          ...(row.name === undefined ? {} : { name: row.name }),
          bars,
        }
      } catch {
        return { symbol: row.symbol, instrument: row.instrument, bars: [] as KlineWire[] }
      }
    })
    const reviews = reviewBotBook(candidates, held)
    const ladders = await laddersFor(source, reviews)
    const filed = await fileHeld(reviews, source)
    const checkedAt = Date.now()
    patch({
      reviews: filed.reviews,
      book,
      ladders,
      skippedFunds: dormant.length,
      watching: true,
      busy: false,
      failed: false,
      checkedAt,
      log: remember(botLogEntry(checkedAt, sourceKind, reviews, filed.mark)),
    })
  } catch {
    const checkedAt = Date.now()
    patch({ busy: false, failed: true, checkedAt, log: remember(failedBotLogEntry(checkedAt, sourceKind)) })
  } finally {
    gate = false
  }
}

function ensureTimer(): void {
  if (timer !== null) return
  timer = setInterval(() => {
    if (!snap.watching || bridge === null) return
    if (moexEquitySession() !== 'trading') return
    void run(bridge, book, 'auto')
  }, WATCH_MS)
}

export const robotSession = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
  get(): RobotSnap {
    return snap
  },
  check(nextBridge: RobotBridge): Promise<void> {
    bridge = nextBridge
    ensureTimer()
    return run(nextBridge, book, 'manual')
  },
  async file(): Promise<BotLogMark['orderNote'] | 'idle'> {
    if (bridge === null || snap.reviews === null || snap.busy || gate) return 'idle'
    gate = true
    try {
      const reviews = snap.reviews
      const filed = await fileHeld(reviews, bridge)
      if (filed.mark === undefined) {
        patch({ book })
        return 'idle'
      }
      patch({
        reviews: filed.reviews,
        book,
        log: remember(botLogEntry(Date.now(), 'manual', reviews, filed.mark)),
      })
      return filed.mark.orderNote
    } finally {
      gate = false
    }
  },
}
