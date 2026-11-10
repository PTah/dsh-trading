import type { StrategySignal } from '@dshtrading/strategies'

/** Последний сигнал правила: entry = сейчас была бы длинная позиция. */
export function stanceOf(signals: readonly StrategySignal[]): 'long' | 'flat' {
  let stance: 'long' | 'flat' = 'flat'
  for (const signal of signals) {
    if (signal.action === 'entry') stance = 'long'
    else if (signal.action === 'exit') stance = 'flat'
  }
  return stance
}
