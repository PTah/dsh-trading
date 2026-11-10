/**
 * 距近期高点的回撤（波段）：靠近高点视为趋势完好，回撤超过阈值离场。
 */
import type { StrategyDefinition, StrategySignal } from '../types.ts'

export const peakDrawdownStrategy: StrategyDefinition = {
  id: 'peak-drawdown',
  horizon: 'swing',
  name: 'Откат от недавнего максимума',
  summary: 'Цена рядом с максимумом за N дней — рост ещё цел. Откат сильнее порога — сокращать.',
  params: [
    { key: 'lookback', label: 'Окно максимума (дни)', default: 60, min: 20, max: 250, step: 5 },
    { key: 'nearHighPct', label: 'Рядом с максимумом, %', default: 5, min: 1, max: 15, step: 1 },
    { key: 'exitDrawdownPct', label: 'Порог выхода, %', default: 15, min: 8, max: 40, step: 1 },
  ],
  compute(bars, params) {
    const lookback = Math.max(5, Math.round(params.lookback ?? 60))
    const nearHigh = Number(params.nearHighPct ?? 5)
    const exitDrawdown = Number(params.exitDrawdownPct ?? 15)
    const signals: StrategySignal[] = []
    let inPosition = false
    for (let index = lookback - 1; index < bars.length; index++) {
      let high = -Infinity
      for (let cursor = index - lookback + 1; cursor <= index; cursor++) {
        const close = bars[cursor]?.close ?? -Infinity
        if (close > high) high = close
      }
      const close = bars[index].close
      if (!(high > 0) || !Number.isFinite(close)) continue
      const drawdown = ((high - close) / high) * 100
      if (!inPosition && drawdown <= nearHigh) {
        signals.push({
          index,
          time: bars[index].openTime,
          action: 'entry',
          direction: 'long',
          price: close,
          reason: `within ${nearHigh}% of the ${lookback}-day high`,
          reasonKey: 'strat.peak-drawdown.reason.entry',
          reasonParams: { lookback, near: nearHigh, dd: drawdown.toFixed(1) },
        })
        inPosition = true
      } else if (inPosition && drawdown >= exitDrawdown) {
        signals.push({
          index,
          time: bars[index].openTime,
          action: 'exit',
          direction: 'flat',
          price: close,
          reason: `drawdown ${drawdown.toFixed(1)}% exceeds ${exitDrawdown}%`,
          reasonKey: 'strat.peak-drawdown.reason.exit',
          reasonParams: { lookback, exit: exitDrawdown, dd: drawdown.toFixed(1) },
        })
        inPosition = false
      }
    }
    return signals
  },
}
