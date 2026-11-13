/**
 * Таблица купленных акций. Стоит над разделами «Стратегии»,
 * чтобы книга не пряталась под журналом робота.
 */
import { useSyncExternalStore } from 'react'
import { holdingViews, type HoldingStatus } from './bot-holdings.ts'
import { robotSession } from './robot-session.ts'
import type { StrategyLocaleKey } from './contract.ts'
import css from './StrategyView.module.css'

type Translate = (key: StrategyLocaleKey, params?: Record<string, unknown>) => string

const STATUS_KEY: Record<HoldingStatus, StrategyLocaleKey> = {
  buy: 'sv.bot.buy',
  add: 'sv.bot.add',
  sell: 'sv.bot.sell',
  hold: 'sv.bot.hold',
  book: 'sv.bot.inBook',
}

function money(value: number | undefined): string {
  if (value === undefined || !(value > 0)) return '—'
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })
}

export function BotHoldings({ t }: { t: Translate }) {
  const snap = useSyncExternalStore(robotSession.subscribe, robotSession.get)
  const rows = holdingViews(snap.book, snap.reviews, snap.log)
  if (rows.length === 0) return null
  return (
    <div className={css.botHoldings} data-dshtrading-bot-holdings="">
      <h3 className={css.botTitle}>{t('sv.bot.holdingsTitle')}</h3>
      <table className={css.botTable}>
        <thead>
          <tr>
            <th>{t('sv.bot.col.paper')}</th>
            <th>{t('sv.bot.col.status')}</th>
            <th>{t('sv.bot.col.lots')}</th>
            <th>{t('sv.bot.col.entry')}</th>
            <th>{t('sv.bot.col.now')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={`${row.booked ? 'book' : 'signal'}-${row.symbol}`}>
              <td>{row.name ?? row.symbol} ({row.symbol})</td>
              <td>{t(STATUS_KEY[row.status])}</td>
              <td>{String(row.lots)}</td>
              <td>{money(row.entryPrice)}</td>
              <td>{money(row.price)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function bookedNames(t: Translate): string {
  const snap = robotSession.get()
  const names = holdingViews(snap.book, snap.reviews, snap.log)
    .filter(row => row.booked)
    .map(row => `${row.name ?? row.symbol} (${row.symbol}), ${String(row.lots)}`)
    .join('; ')
  return names === '' ? '' : t('sv.bot.bannerBook', { names })
}
