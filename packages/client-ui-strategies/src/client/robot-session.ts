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
  ladders: Record<string, BondLadder>
  skippedFunds: number
  watching: boolean
  busy: boolean
  failed: boolean
  checkedAt: number | null
}

const listeners = new Set<() => void>()
let snap: RobotSnap = {
  reviews: null,
  ladders: {},
  skippedFunds: 0,
  watching: false,
  busy: false,
  failed: false,
  checkedAt: null,
}
let bridge: RobotBridge | null = null
let book: BotPosition[] = []
let timer: ReturnType<typeof setInterval> | null = null

function emit(): void {
  for (const listener of listeners) listener()
}

function patch(partial: Partial<RobotSnap>): void {
  snap = { ...snap, ...partial }
  emit()
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

async function run(source: RobotBridge, held: readonly BotPosition[]): Promise<void> {
  if (snap.busy) return
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
    patch({
      reviews,
      ladders,
      skippedFunds: dormant.length,
      watching: true,
      busy: false,
      failed: false,
      checkedAt: Date.now(),
    })
  } catch {
    patch({ busy: false, failed: true })
  }
}

function ensureTimer(): void {
  if (timer !== null) return
  timer = setInterval(() => {
    if (!snap.watching || bridge === null) return
    if (moexEquitySession() !== 'trading') return
    void run(bridge, book)
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
  holdBook(next: readonly BotPosition[]): void {
    book = [...next]
  },
  check(nextBridge: RobotBridge, nextBook: readonly BotPosition[]): Promise<void> {
    bridge = nextBridge
    book = [...nextBook]
    ensureTimer()
    return run(nextBridge, nextBook)
  },
}
