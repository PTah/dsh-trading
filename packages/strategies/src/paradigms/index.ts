/**
 * 9 个策略参考范式：6 个经典范式 + 3 个面向私人投资者的趋势/RSI/回撤规则。
 */
import { donchianBreakoutStrategy } from './donchian-breakout.ts'
import { rsiReversionStrategy } from './rsi-reversion.ts'
import { emaCrossoverStrategy } from './ema-crossover.ts'
import { bollingerReversionStrategy } from './bollinger-reversion.ts'
import { smaBaselineStrategy } from './sma-baseline.ts'
import { momentum12mStrategy } from './momentum-12m.ts'
import { trendSmaStrategy } from './trend-sma.ts'
import { rsi14BandStrategy } from './rsi-14-band.ts'
import { peakDrawdownStrategy } from './peak-drawdown.ts'
import type { StrategyDefinition } from '../types.ts'

export {
  donchianBreakoutStrategy,
  rsiReversionStrategy,
  emaCrossoverStrategy,
  bollingerReversionStrategy,
  smaBaselineStrategy,
  momentum12mStrategy,
  trendSmaStrategy,
  rsi14BandStrategy,
  peakDrawdownStrategy,
}

export const strategyParadigms: readonly StrategyDefinition[] = [
  donchianBreakoutStrategy,
  rsiReversionStrategy,
  emaCrossoverStrategy,
  bollingerReversionStrategy,
  smaBaselineStrategy,
  momentum12mStrategy,
  trendSmaStrategy,
  rsi14BandStrategy,
  peakDrawdownStrategy,
]

export function getStrategyById(id: string): StrategyDefinition | undefined {
  return strategyParadigms.find((s) => s.id === id)
}
