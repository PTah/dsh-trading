/**
 * Станция робота на вкладке «Стратегии».
 * Проверка читает дневные свечи первых акций из списка «Россия».
 * В открытую сессию проверка сама пишет учебную заявку по акции.
 * Учебная заявка всегда dry-run и на биржу не уходит. Книга лежит отдельно от избранного.
 */
import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  moexEquitySession,
  moexNextTradingOpen,
  type BotKind,
  type BotReason,
  type BotReview,
  type BotVerdict,
  type MoexSession,
} from '@dshtrading/strategies'
import type { BotLogEntry, BotLogHit } from './bot-log.ts'
import { robotSession, type BondLadder } from './robot-session.ts'
import type { StrategyLocaleKey } from './contract.ts'
import css from './StrategyView.module.css'

type Translate = (key: StrategyLocaleKey, params?: Record<string, unknown>) => string

function waitUntilOpen(t: Translate, now: number): { wait: string; local: string } {
  const openAt = moexNextTradingOpen(now)
  const local = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(openAt)
  const total = Math.ceil((openAt.getTime() - now) / 60_000)
  if (total <= 0) return { wait: t('sv.bot.waitSoon'), local }
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  if (hours === 0) return { wait: t('sv.bot.waitMinutes', { minutes: String(minutes) }), local }
  if (minutes === 0) return { wait: t('sv.bot.waitHoursOnly', { hours: String(hours) }), local }
  return { wait: t('sv.bot.waitHours', { hours: String(hours), minutes: String(minutes) }), local }
}

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
  fetchSymbols: (market: string) => Promise<Array<{ symbol: string; name?: string; listing?: string }>>
  fetchTickers?: (market: string, symbols: string[]) => Promise<Record<string, {
    ok?: boolean
    ticker?: { bond?: { nominal: number; aci: number; pricePercent: number; clean: number; dirty: number; couponPay?: number; maturity?: string; couponsPerYear?: number } }
  }>>
  placeBotDryRunOrder?: (input: { symbol: string; side: 'buy' | 'sell'; quantity: number }) => Promise<{ order?: unknown; error?: string }>
}

const SESSION_KEY: Record<MoexSession, StrategyLocaleKey> = {
  trading: 'sv.bot.sessionOpen',
  closed: 'sv.bot.sessionClosed',
  auction: 'sv.bot.sessionAuction',
}

const LOG_HIT_KEY: Record<BotLogHit['verdict'], StrategyLocaleKey> = {
  buy: 'sv.bot.buy',
  add: 'sv.bot.add',
  sell: 'sv.bot.sell',
  'bond-add': 'sv.bot.bondAdd',
  'fund-entry': 'sv.bot.fundEntry',
}

function logWhen(at: number): string {
  return new Intl.DateTimeFormat(undefined, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at)
}

function LogList({ log, t }: { log: readonly BotLogEntry[]; t: Translate }) {
  return (
    <>
      <h3 className={css.botTitle}>{t('sv.bot.logTitle')}</h3>
      {log.length === 0 ? <p className={css.cardSummary}>{t('sv.bot.logEmpty')}</p> : (
        <ul className={`${css.botList} ${css.botLog}`}>
          {log.map((row, index) => {
            const when = logWhen(row.at)
            const source = t(row.source === 'auto' ? 'sv.bot.logAuto' : 'sv.bot.logManual')
            const names = row.hits.map(hit => `${hit.name ?? hit.symbol} — ${t(LOG_HIT_KEY[hit.verdict])}`).join(', ')
            const filed = row.hits
              .filter(hit => hit.verdict === 'buy' || hit.verdict === 'add' || hit.verdict === 'sell')
              .map(hit => `${hit.name ?? hit.symbol} — ${t(LOG_HIT_KEY[hit.verdict])}`)
              .join(', ')
            const line = !row.ok
              ? t('sv.bot.logFail', { when, source })
              : row.orderNote === 'sent'
                ? t('sv.bot.logLineSent', {
                  when, source, looked: String(row.looked), buys: String(row.buys), adds: String(row.adds),
                  sells: String(row.sells), bonds: String(row.bonds), names: filed,
                })
                : row.orderNote === 'closed'
                  ? t('sv.bot.logLineClosed', {
                    when, source, looked: String(row.looked), buys: String(row.buys), adds: String(row.adds),
                    sells: String(row.sells), bonds: String(row.bonds),
                  })
                  : row.orderNote === 'failed'
                    ? t('sv.bot.logLineFailed', {
                      when, source, looked: String(row.looked), buys: String(row.buys), adds: String(row.adds),
                      sells: String(row.sells), bonds: String(row.bonds),
                    })
                    : t('sv.bot.logLine', {
                      when, source, looked: String(row.looked), buys: String(row.buys), adds: String(row.adds),
                      sells: String(row.sells), bonds: String(row.bonds),
                    })
            return (
              <li key={`${row.at}-${row.source}-${index}`}>
                {line}
                {names !== '' && <div>{names}</div>}
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
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

const VERDICT_KEY: Record<Exclude<BotVerdict, BotKind>, { title: StrategyLocaleKey; detail: StrategyLocaleKey }> = {
  'no-cross': { title: 'sv.bot.skip', detail: 'sv.bot.verdict.no-cross' },
  'short-history': { title: 'sv.bot.shortLabel', detail: 'sv.bot.verdict.short-history' },
  'no-bars': { title: 'sv.bot.unreadLabel', detail: 'sv.bot.verdict.no-bars' },
  'passed-over': { title: 'sv.bot.passedLabel', detail: 'sv.bot.verdict.passed-over' },
  rising: { title: 'sv.bot.rising', detail: 'sv.bot.verdict.rising' },
  'no-short': { title: 'sv.bot.noShort', detail: 'sv.bot.verdict.no-short' },
  'fund-entry': { title: 'sv.bot.fundEntry', detail: 'sv.bot.verdict.fund-entry' },
  'cash-skip': { title: 'sv.bot.cashSkip', detail: 'sv.bot.verdict.cash-skip' },
  'bond-add': { title: 'sv.bot.bondAdd', detail: 'sv.bot.verdict.bond-add' },
  'bond-discount': { title: 'sv.bot.bondDiscount', detail: 'sv.bot.verdict.bond-discount' },
  'bond-rich': { title: 'sv.bot.bondRich', detail: 'sv.bot.verdict.bond-rich' },
  'bond-hold': { title: 'sv.bot.bondHold', detail: 'sv.bot.verdict.bond-hold' },
  'bond-fund-down': { title: 'sv.bot.bondFundDown', detail: 'sv.bot.verdict.bond-fund-down' },
  'bond-fund-flat': { title: 'sv.bot.bondFundFlat', detail: 'sv.bot.verdict.bond-fund-flat' },
}

const ADVICE: readonly BotVerdict[] = ['bond-add', 'fund-entry']

function renderReview(row: BotReview, t: Translate) {
  const quiet = VERDICT_KEY[row.verdict as Exclude<BotVerdict, BotKind>]
  const title = quiet === undefined ? t(KIND_KEY[row.verdict as BotKind]) : t(quiet.title)
  const detail = quiet === undefined
    ? (row.reason === undefined ? '' : t(REASON_KEY[row.reason]))
    : t(quiet.detail)
  const percent = row.instrument === 'ofz' || row.instrument === 'bond' ? '%' : ''
  const price = row.price > 0 ? ` · ${row.price.toFixed(2)}${percent}` : ''
  const move = row.move === undefined ? '' : ` · ${row.move > 0 ? '+' : ''}${row.move.toFixed(2)}`
  const lots = row.lots > 0 ? ` · ${row.lots}` : ''
  return (
    <li key={`${row.verdict}-${row.symbol}`}>
      <strong>{title}</strong>
      {' '}
      {row.name ?? row.symbol}
      {' '}
      ({row.symbol}){lots}{price}{move}
      <div>{detail}</div>
    </li>
  )
}

function money(value: number): string {
  return Math.round(value).toLocaleString('ru-RU')
}

function Ladder({ ladder, t }: { ladder: BondLadder | undefined; t: Translate }) {
  if (ladder === undefined || ladder.steps.length === 0) return null
  const end = ladder.steps.find(step => step.redeemed)
  if (!ladder.couponsKnown) {
    if (end === undefined) return null
    return <li>{t('sv.bot.ladderNoCoupon', { years: String(end.years), result: money(end.result) })}</li>
  }
  return (
    <li>
      {ladder.steps.map(step => (
        <div key={`${step.years}-${step.redeemed ? 'end' : 'year'}`}>
          {step.redeemed
            ? t('sv.bot.ladderEnd', {
              years: String(step.years),
              coupons: money(step.coupons),
              result: money(step.result),
            })
            : t('sv.bot.ladderYear', { years: String(step.years), coupons: money(step.coupons) })}
        </div>
      ))}
    </li>
  )
}

export function BotPane({ t, bridge }: { t: Translate; bridge: BotPaneBridge }) {
  const snap = useSyncExternalStore(robotSession.subscribe, robotSession.get)
  const book = snap.book
  const [busy, setBusy] = useState<'submit' | null>(null)
  const busyRef = useRef<'submit' | null>(null)
  const [note, setNote] = useState<string>('')
  const [now, setNow] = useState(() => Date.now())
  const session = moexEquitySession(now)

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const reviews = snap.reviews
  const skippedFunds = snap.skippedFunds
  const watching = snap.watching

  const submit = async (): Promise<void> => {
    if (reviews === null || bridge.placeBotDryRunOrder === undefined) return
    const liveSession = moexEquitySession()
    setNow(Date.now())
    if (liveSession !== 'trading') {
      setNote(t(SESSION_KEY[liveSession], waitUntilOpen(t, Date.now())))
      return
    }
    if (busyRef.current !== null) return
    busyRef.current = 'submit'
    setBusy('submit')
    setNote('')
    try {
      const result = await robotSession.file()
      setNote(result === 'sent' ? t('sv.bot.sent') : result === 'failed' ? t('sv.bot.failed') : '')
    } finally {
      busyRef.current = null
      setBusy(null)
    }
  }

  const rows = reviews ?? []
  const orders = rows.filter(row => row.instrument === 'share' && (row.verdict === 'buy' || row.verdict === 'add' || row.verdict === 'sell'))
  const holds = rows.filter(row => row.verdict === 'hold')
  const advice = rows.filter(row => ADVICE.includes(row.verdict))
  const rising = rows.filter(row => row.verdict === 'rising')
  const rest = reviews === null ? null : {
    discount: String(rows.filter(row => row.verdict === 'bond-discount').length),
    near: String(rows.filter(row => row.verdict === 'bond-hold').length),
    rich: String(rows.filter(row => row.verdict === 'bond-rich').length),
    flat: String(rows.filter(row => row.verdict === 'no-cross' || row.verdict === 'passed-over').length),
    shorts: String(rows.filter(row => row.verdict === 'no-short').length),
    unread: String(rows.filter(row => row.verdict === 'no-bars' || row.verdict === 'short-history').length),
  }
  const report = reviews === null ? null : {
    count: String(rows.length),
    ready: String(rows.filter(row => row.verdict !== 'no-bars').length),
    unread: String(rows.filter(row => row.verdict === 'no-bars').length),
    buys: String(rows.filter(row => row.verdict === 'buy').length),
    adds: String(rows.filter(row => row.verdict === 'add').length),
    sells: String(rows.filter(row => row.verdict === 'sell').length),
  }

  return (
    <div className={css.botPane} data-dshtrading-bot="">
      <p className={css.cardSummary}>{t('sv.bot.hint')}</p>
      <p className={css.cardSummary}>{t('sv.bot.dryRun')}</p>
      <p className={css.cardSummary}>
        {session === 'trading' ? t(SESSION_KEY[session]) : t(SESSION_KEY[session], waitUntilOpen(t, now))}
      </p>
      <div className={css.mgmtRow}>
        <button type="button" className={css.horizonBtn} disabled={busy !== null || snap.busy} onClick={() => { void robotSession.check(bridge) }}>
          {snap.busy ? t('sv.bot.checking') : t('sv.bot.check')}
        </button>
        <button
          type="button"
          className={css.horizonBtn}
          disabled={busy !== null || snap.busy || orders.length === 0 || session !== 'trading' || bridge.placeBotDryRunOrder === undefined}
          onClick={() => { void submit() }}
        >
          {busy === 'submit' ? t('sv.bot.submitting') : t('sv.bot.submit')}
        </button>
      </div>
      {watching && <p className={css.cardSummary}>{t('sv.bot.watching')}</p>}
      {snap.failed && <p className={css.cardSummary}>{t('sv.bot.checkFailed')}</p>}
      {note !== '' && <p className={css.cardSummary}>{note}</p>}
      {report !== null && rows.length === 0 && (
        <p className={css.cardSummary}>{t('sv.bot.empty')}</p>
      )}
      {report !== null && rows.length > 0 && (
        <p className={css.cardSummary}>{t('sv.bot.report', report)}</p>
      )}
      {[...orders, ...holds].length > 0 && (
        <ul className={css.botList}>
          {[...orders, ...holds].map(row => renderReview(row, t))}
        </ul>
      )}
      {reviews !== null && skippedFunds > 0 && (
        <p className={css.cardSummary}>{t('sv.bot.finex', { count: String(skippedFunds) })}</p>
      )}
      {reviews !== null && (
        <>
          <h3 className={css.botTitle}>{t('sv.bot.adviceTitle')}</h3>
          {advice.length === 0
            ? <p className={css.cardSummary}>{t('sv.bot.adviceEmpty')}</p>
            : (
              <ul className={css.botList}>
                {advice.map(row => (
                  <Fragment key={`${row.verdict}-${row.symbol}`}>
                    {renderReview(row, t)}
                    <Ladder ladder={snap.ladders[row.symbol]} t={t} />
                  </Fragment>
                ))}
              </ul>
            )}
        </>
      )}
      {rising.length > 0 && (
        <p className={css.cardSummary}>{t('sv.bot.risingLine', { names: rising.map(row => row.name ?? row.symbol).join(', ') })}</p>
      )}
      {rest !== null && (
        <p className={css.cardSummary}>{t('sv.bot.rest', rest)}</p>
      )}
      <LogList log={snap.log} t={t} />
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
