import { useSyncExternalStore } from 'react'
import type { StrategyLocaleKey } from './contract.ts'
import { robotSession } from './robot-session.ts'
import css from './StrategyView.module.css'

type Translate = (key: StrategyLocaleKey, params?: Record<string, unknown>) => string

export function RobotBanner({ t }: { t: Translate }) {
  const snap = useSyncExternalStore(robotSession.subscribe, robotSession.get)
  const advice = (snap.reviews ?? []).filter(row => row.verdict === 'bond-add').length
  const time = snap.checkedAt === null
    ? ''
    : new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(snap.checkedAt)
  return (
    <p className={css.robotBanner}>
      {snap.watching
        ? t('sv.bot.bannerOn', { time, count: String(advice) })
        : t('sv.bot.bannerIdle')}
      {snap.busy ? ` ${t('sv.bot.checking')}` : ''}
    </p>
  )
}
