import { useSyncExternalStore } from 'react'
import type { StrategyLocaleKey } from './contract.ts'
import type { BotLogEntry } from './bot-log.ts'
import { robotSession } from './robot-session.ts'
import css from './StrategyView.module.css'

type Translate = (key: StrategyLocaleKey, params?: Record<string, unknown>) => string

function clock(at: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at)
}

function bannerParams(t: Translate, last: BotLogEntry | undefined, fallbackAt: number | null): Record<string, string> {
  const at = last?.at ?? fallbackAt
  return {
    time: at === null || at === undefined ? '' : clock(at),
    source: last === undefined ? '' : t(last.source === 'auto' ? 'sv.bot.logAuto' : 'sv.bot.logManual'),
    buys: String(last?.buys ?? 0),
    adds: String(last?.adds ?? 0),
    sells: String(last?.sells ?? 0),
    bonds: String(last?.bonds ?? 0),
  }
}

export function RobotBanner({ t }: { t: Translate }) {
  const snap = useSyncExternalStore(robotSession.subscribe, robotSession.get)
  const last = snap.log[0]
  return (
    <p className={css.robotBanner}>
      {snap.watching
        ? t(last !== undefined && !last.ok ? 'sv.bot.bannerFail' : 'sv.bot.bannerOn', bannerParams(t, last, snap.checkedAt))
        : t('sv.bot.bannerIdle')}
      {snap.busy ? ` ${t('sv.bot.checking')}` : ''}
    </p>
  )
}
