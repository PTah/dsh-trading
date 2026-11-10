/**
 * SMA20/SMA50 趋势（波段）：快线站上慢线做多，跌回慢线下方离场。
 * compute 自包含，便于策略管理导出源码。
 */
import type { StrategyDefinition, StrategySignal } from '../types.ts'

export const trendSmaStrategy: StrategyDefinition = {
  id: 'trend-sma',
  horizon: 'swing',
  name: 'Тренд по двум средним',
  summary: 'Простая средняя за 20 дней выше средней за 50 дней — держать рост; обратно — выходить.',
  params: [
    { key: 'fast', label: 'Короткая средняя', default: 20, min: 5, max: 60, step: 1 },
    { key: 'slow', label: 'Длинная средняя', default: 50, min: 20, max: 200, step: 1 },
  ],
  compute(bars, params) {
    const fast = Math.max(2, Math.round(params.fast ?? 20))
    const slow = Math.max(fast + 1, Math.round(params.slow ?? 50))
    const smaOf = (values: number[], period: number): Array<number | undefined> => {
      const out: Array<number | undefined> = new Array(values.length).fill(undefined)
      let sum = 0
      for (let index = 0; index < values.length; index++) {
        sum += values[index] as number
        if (index >= period) sum -= values[index - period] as number
        if (index >= period - 1) out[index] = sum / period
      }
      return out
    }
    const closes = bars.map((bar) => bar.close)
    const fastSma = smaOf(closes, fast)
    const slowSma = smaOf(closes, slow)
    const signals: StrategySignal[] = []
    let inPosition = false
    for (let index = 1; index < bars.length; index++) {
      const prevFast = fastSma[index - 1]
      const prevSlow = slowSma[index - 1]
      const currFast = fastSma[index]
      const currSlow = slowSma[index]
      if (prevFast === undefined || prevSlow === undefined || currFast === undefined || currSlow === undefined) continue
      if (!inPosition && prevFast <= prevSlow && currFast > currSlow) {
        signals.push({
          index,
          time: bars[index].openTime,
          action: 'entry',
          direction: 'long',
          price: bars[index].close,
          reason: `SMA(${fast}) crossed above SMA(${slow})`,
          reasonKey: 'strat.trend-sma.reason.entry',
          reasonParams: { fast, slow },
        })
        inPosition = true
      } else if (inPosition && prevFast >= prevSlow && currFast < currSlow) {
        signals.push({
          index,
          time: bars[index].openTime,
          action: 'exit',
          direction: 'flat',
          price: bars[index].close,
          reason: `SMA(${fast}) crossed below SMA(${slow})`,
          reasonKey: 'strat.trend-sma.reason.exit',
          reasonParams: { fast, slow },
        })
        inPosition = false
      }
    }
    return signals
  },
}
