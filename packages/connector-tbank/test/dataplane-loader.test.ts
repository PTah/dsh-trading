/**
 * dataplane 入口必须自带 Config（loader 补默认值）。
 */
import { describe, expect, it } from 'vitest'
import { resolveConfig, type Context } from '@deepseek-ai/cordis'
import * as dataplane from '../src/dataplane.ts'
import {
  TRADING_MARKET_DATA_KEY,
  TRADING_TRADE_KEY,
  type Config as ConfigType,
} from '../src/index.ts'

interface Registration { market: string; provider: string; service: unknown }

function registryCtx(): {
  ctx: Context
  market: Registration[]
  trade: Registration[]
  isolated: string[]
} {
  const market: Registration[] = []
  const trade: Registration[] = []
  const isolated: string[] = []
  const marketRegistry = {
    register: (m: string, p: string, service: unknown) => {
      market.push({ market: m, provider: p, service })
      return () => {}
    },
  }
  const tradeRegistry = {
    register: (m: string, p: string, service: unknown) => {
      trade.push({ market: m, provider: p, service })
      return () => {}
    },
  }
  const ctx = {
    get: (key: string) => {
      if (key === 'tradingMarketDataRegistry') return marketRegistry
      if (key === 'tradingTradeRegistry') return tradeRegistry
      return undefined
    },
    isolate: (name: string) => {
      isolated.push(name)
      return { reflect: { provide: () => {} } }
    },
    effect: (fn: () => () => void) => { fn() },
    reflect: { provide: () => {} },
  } as unknown as Context
  return { ctx, market, trade, isolated }
}

const plugin = (dataplane as unknown as { default?: unknown }).default ?? dataplane

describe('connector-tbank dataplane loader 面', () => {
  it('子入口导出 apply 与 Config', () => {
    expect(typeof dataplane.apply).toBe('function')
    expect(dataplane.Config).toBeDefined()
    expect(dataplane.inject).toEqual([])
  })

  it('行只写 enabled=true 时补全 token ref 与 env=demo', () => {
    const resolved = resolveConfig(plugin as never, { enabled: true }) as ConfigType
    expect(resolved.enabled).toBe(true)
    expect(resolved.env).toBe('demo')
    expect(resolved.tokenRef).toBe('TBANK_TOKEN')
    expect(resolved.demoTokenRef).toBe('TBANK_DEMO_TOKEN')
  })

  it('apply 后行情与交易注册表都拿到 (ru, tbank)', () => {
    const { ctx, market, trade, isolated } = registryCtx()
    dataplane.apply(ctx, resolveConfig(plugin as never, { enabled: true }) as ConfigType)
    expect(isolated).toContain(TRADING_MARKET_DATA_KEY)
    expect(isolated).toContain(TRADING_TRADE_KEY)
    expect(market).toEqual([expect.objectContaining({ market: 'ru', provider: 'tbank' })])
    expect(trade).toEqual([expect.objectContaining({ market: 'ru', provider: 'tbank' })])
  })
})
