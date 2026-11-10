/**
 * Станция робота на вкладке «Стратегии».
 * Проверка читает дневные свечи первых акций из списка «Россия».
 * Учебная заявка всегда dry-run. Книга лежит отдельно от избранного.
 */
import { useEffect, useState } from 'react'
import {
  applyBotFill,
  botTradableShare,
  decideBotBook,
  moexEquitySession,
  type BotAction,
  type BotKind,
  type BotPosition,
  type BotReason,
  type MoexSession,
} from '@dshtrading/strategies'
import { readJson, writeJson } from './shell-faces.ts'
import type { StrategyLocaleKey } from './contract.ts'
import css from './StrategyView.module.css'

const BOOK_KEY = 'dshtrading.bot.book.v1'
const SCAN_LIMIT = 30
const CONCURRENCY = 4

type Translate = (key: StrategyLocaleKey) => string

interface KlineWire {
  openTime: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface BotPaneBridge {
  fetchKlines: (market: string, symbol: string, interval: string, limit: number) => Promise<KlineWire[]>
  fetchSymbols: (market: string) => Promise<Array<{ symbol: string; name?: string }>>
  placeBotDryRunOrder?: (input: { symbol: string; side: 'buy' | 'sell'; quantity: number }) => Promise<{ order?: unknown; error?: string }>
}

const SESSION_KEY: Record<MoexSession, StrategyLocaleKey> = {
  trading: 'sv.bot.sessionOpen',
  closed: 'sv.bot.sessionClosed',
  auction: 'sv.bot.sessionAuction',
}

const KIND_KEY: Record<BotKind, StrategyLocaleKey> = {
  buy: 'sv.bot.buy',
  add: 'sv.bot.add',
  sell: 'sv.bot.sell',
  hold: 'sv.bot.hold',
}

const REASON_KEY: Record<BotReason, StrategyLocaleKey> = {
  'fresh-cross': 'sv.bot.reason.fresh-cross',
  'trend-broken': 'sv.bot.reason.trend-broken',
  pullback: 'sv.bot.reason.pullback',
  hold: 'sv.bot.reason.hold',
}

function loadBook(): BotPosition[] {
  const raw = readJson<BotPosition[]>(BOOK_KEY, [])
  return Array.isArray(raw) ? raw.filter(row => typeof row?.symbol === 'string' && row.symbol !== '') : []
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

export function BotPane({ t, bridge }: { t: Translate; bridge: BotPaneBridge }) {
  const [book, setBook] = useState<BotPosition[]>(() => loadBook())
  const [actions, setActions] = useState<BotAction[] | null>(null)
  const [busy, setBusy] = useState<'check' | 'submit' | null>(null)
  const [note, setNote] = useState<string>('')
  const [now, setNow] = useState(() => Date.now())
  const session = moexEquitySession(now)

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const save = (next: BotPosition[]): void => {
    setBook(next)
    writeJson(BOOK_KEY, next)
  }

  const check = async (): Promise<void> => {
    setBusy('check')
    setNote('')
    try {
      const symbols = await bridge.fetchSymbols('ru')
      const shares = symbols.filter(row => botTradableShare(row.symbol)).slice(0, SCAN_LIMIT)
      const extra = book.filter(row => !shares.some(share => share.symbol.toUpperCase() === row.symbol.toUpperCase()))
      const queue = [
        ...shares,
        ...extra.map(row => ({ symbol: row.symbol, name: row.symbol })),
      ]
      const candidates = await mapPool(queue, CONCURRENCY, async (row) => {
        try {
          const bars = await bridge.fetchKlines('ru', row.symbol, '1d', 120)
          return { symbol: row.symbol, ...(row.name === undefined ? {} : { name: row.name }), bars }
        } catch {
          return { symbol: row.symbol, bars: [] as KlineWire[] }
        }
      })
      setActions(decideBotBook(candidates, book))
    } catch {
      setNote(t('sv.bot.checkFailed'))
    } finally {
      setBusy(null)
    }
  }

  const submit = async (): Promise<void> => {
    if (actions === null || bridge.placeBotDryRunOrder === undefined) return
    const orders = actions.filter(row => row.kind === 'buy' || row.kind === 'add' || row.kind === 'sell')
    if (orders.length === 0) return
    const liveSession = moexEquitySession()
    setNow(Date.now())
    if (liveSession !== 'trading') {
      setNote(t(SESSION_KEY[liveSession]))
      return
    }
    setBusy('submit')
    setNote('')
    let next = book
    let failed = 0
    for (const action of orders) {
      const side = action.kind === 'sell' ? 'sell' as const : 'buy' as const
      const result = await bridge.placeBotDryRunOrder({ symbol: action.symbol, side, quantity: action.lots })
      if (result.order === undefined) {
        failed += 1
        continue
      }
      next = applyBotFill(next, action)
    }
    save(next)
    setActions(null)
    setNote(failed === 0 ? t('sv.bot.sent') : t('sv.bot.failed'))
    setBusy(null)
  }

  const orders = (actions ?? []).filter(row => row.kind !== 'hold')
  const holds = (actions ?? []).filter(row => row.kind === 'hold')

  return (
    <div className={css.botPane} data-dshtrading-bot="">
      <p className={css.cardSummary}>{t('sv.bot.hint')}</p>
      <p className={css.cardSummary}>{t('sv.bot.dryRun')}</p>
      <p className={css.cardSummary}>{t(SESSION_KEY[session])}</p>
      <div className={css.mgmtRow}>
        <button type="button" className={css.horizonBtn} disabled={busy !== null} onClick={() => { void check() }}>
          {busy === 'check' ? t('sv.bot.checking') : t('sv.bot.check')}
        </button>
        <button
          type="button"
          className={css.horizonBtn}
          disabled={busy !== null || orders.length === 0 || session !== 'trading' || bridge.placeBotDryRunOrder === undefined}
          onClick={() => { void submit() }}
        >
          {busy === 'submit' ? t('sv.bot.submitting') : t('sv.bot.submit')}
        </button>
      </div>
      {note !== '' && <p className={css.cardSummary}>{note}</p>}
      {actions !== null && orders.length === 0 && holds.length === 0 && (
        <p className={css.cardSummary}>{t('sv.bot.empty')}</p>
      )}
      {orders.length > 0 && (
        <ul className={css.botList}>
          {orders.map(row => (
            <li key={`${row.kind}-${row.symbol}`}>
              <strong>{t(KIND_KEY[row.kind])}</strong>
              {' '}
              {row.name ?? row.symbol}
              {' '}
              ({row.symbol}) · {row.lots} · {row.price.toFixed(2)}
              <div>{t(REASON_KEY[row.reason])}</div>
            </li>
          ))}
        </ul>
      )}
      {holds.length > 0 && (
        <ul className={css.botList}>
          {holds.map(row => (
            <li key={`hold-${row.symbol}`}>
              <strong>{t('sv.bot.hold')}</strong>
              {' '}
              {row.name ?? row.symbol}
              {' '}
              ({row.symbol}) · {row.lots}
              <div>{t(REASON_KEY[row.reason])}</div>
            </li>
          ))}
        </ul>
      )}
      <h3 className={css.botTitle}>{t('sv.bot.book')}</h3>
      {book.length === 0 ? <p className={css.cardSummary}>{t('sv.bot.bookEmpty')}</p> : (
        <ul className={css.botList}>
          {book.map(row => (
            <li key={row.symbol}>{row.symbol} · {row.lots} · {t('sv.bot.add')}: {row.adds}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
