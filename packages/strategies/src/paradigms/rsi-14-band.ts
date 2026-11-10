/**
 * RSI(14) 区间（短线）：低于超卖阈值买入，高于超买阈值离场。
 * 阈值对齐常见股票口径（约 32 / 72），不是 RSI(2) 极值回归。
 */
import type { StrategyDefinition, StrategySignal } from '../types.ts'

export const rsi14BandStrategy: StrategyDefinition = {
  id: 'rsi-14-band',
  horizon: 'short',
  name: 'Зона RSI за 14 дней',
  summary: 'RSI(14) в зоне перепроданности — искать отскок; в зоне перекупленности — не докупать.',
  params: [
    { key: 'period', label: 'Период RSI', default: 14, min: 7, max: 30, step: 1 },
    { key: 'oversold', label: 'Порог перепроданности', default: 32, min: 15, max: 45, step: 1 },
    { key: 'overbought', label: 'Порог перекупленности', default: 72, min: 55, max: 90, step: 1 },
  ],
  compute(bars, params) {
    const period = Math.max(2, Math.round(params.period ?? 14))
    const oversold = Number(params.oversold ?? 32)
    const overbought = Number(params.overbought ?? 72)
    const closes = bars.map((bar) => bar.close)
    const rsi: Array<number | undefined> = new Array(closes.length).fill(undefined)
    if (closes.length > period) {
      let gain = 0
      let loss = 0
      for (let index = 1; index <= period; index++) {
        const delta = (closes[index] as number) - (closes[index - 1] as number)
        if (delta >= 0) gain += delta
        else loss -= delta
      }
      gain /= period
      loss /= period
      rsi[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss)
      for (let index = period + 1; index < closes.length; index++) {
        const delta = (closes[index] as number) - (closes[index - 1] as number)
        gain = (gain * (period - 1) + Math.max(delta, 0)) / period
        loss = (loss * (period - 1) + Math.max(-delta, 0)) / period
        rsi[index] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss)
      }
    }
    const signals: StrategySignal[] = []
    let inPosition = false
    for (let index = 0; index < bars.length; index++) {
      const value = rsi[index]
      if (value === undefined || Number.isNaN(value)) continue
      if (!inPosition && value < oversold) {
        signals.push({
          index,
          time: bars[index].openTime,
          action: 'entry',
          direction: 'long',
          price: bars[index].close,
          reason: `RSI(${period}) oversold`,
          reasonKey: 'strat.rsi-14-band.reason.entry',
          reasonParams: { period, val: value.toFixed(1), thresh: oversold },
        })
        inPosition = true
      } else if (inPosition && value > overbought) {
        signals.push({
          index,
          time: bars[index].openTime,
          action: 'exit',
          direction: 'flat',
          price: bars[index].close,
          reason: `RSI(${period}) overbought`,
          reasonKey: 'strat.rsi-14-band.reason.exit',
          reasonParams: { period, val: value.toFixed(1), thresh: overbought },
        })
        inPosition = false
      }
    }
    return signals
  },
}
