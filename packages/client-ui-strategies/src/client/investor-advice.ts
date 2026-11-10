import type { StrategyHorizon } from '@dshtrading/strategies'

export type InvestorAction = 'buy' | 'hold' | 'reduce' | 'watch'

export interface StanceRow {
  horizon: StrategyHorizon
  stance: 'long' | 'flat'
}

/**
 * Сводка правил в одно действие для частного инвестора.
 * Длинный горизонт весит больше: без него большинство коротких «входов» не становится покупкой.
 */
export function advise(rows: readonly StanceRow[]): InvestorAction {
  if (rows.length === 0) return 'watch'
  const longRows = rows.filter((row) => row.stance === 'long')
  const ratio = longRows.length / rows.length
  const longHorizon = rows.find((row) => row.horizon === 'long')
  if (longHorizon?.stance === 'flat' && ratio < 0.34) return 'reduce'
  if (ratio >= 0.66 && longHorizon?.stance === 'long') return 'buy'
  if (ratio >= 0.5) return 'hold'
  if (ratio < 0.34) return 'reduce'
  return 'watch'
}
