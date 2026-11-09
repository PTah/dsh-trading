/**
 * Host 面数据行：注册 (ru, tbank) 行情与交易服务到注册表。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { MarketDataService, TradeRegistry } from '@dshtrading/api'
import {
  Config,
  ROUTER_PROVIDER,
  TRADING_RU_MARKET_DATA_KEY,
  TRADING_TRADE_KEY,
  TBankMarketDataService,
  TBankTradeService,
  credentialRefsFor,
  resolveCredentials,
} from './index.js'

export const inject: string[] = []

export { Config }

const withDefaults = (value: unknown): Config => (Config as unknown as (v: unknown) => Config)(value)

interface MarketDataRegistryLike {
  register(market: string, provider: string, service: MarketDataService): () => void
}

function resolveMarketDataRegistry(ctx: Context): MarketDataRegistryLike | undefined {
  const candidate = (ctx as unknown as { get?: (key: string, strict?: boolean) => unknown }).get?.(
    'tradingMarketDataRegistry',
    false,
  )
  return candidate !== undefined ? (candidate as MarketDataRegistryLike) : undefined
}

function resolveTradeRegistry(ctx: Context): TradeRegistry | undefined {
  const candidate = (ctx as unknown as { get?: (key: string, strict?: boolean) => unknown }).get?.(
    'tradingTradeRegistry',
    false,
  )
  return candidate !== undefined ? (candidate as TradeRegistry) : undefined
}

const MARKET = 'ru'

export function apply(ctx: Context, config: Config = withDefaults(undefined)): void {
  if (!config.enabled) return
  const registry = resolveMarketDataRegistry(ctx)
  const options = {
    env: config.env,
    ...(config.accountId.trim() ? { accountId: config.accountId.trim() } : {}),
  }
  const getCredsOptional = async () => {
    const refs = credentialRefsFor(config)
    return resolveCredentials(ctx, refs, config.env)
  }
  const getCredsRequired = async () => {
    const creds = await getCredsOptional()
    if (!creds) throw new Error('T-Bank credentials missing')
    return creds
  }

  if (registry === undefined) {
    new TBankMarketDataService(ctx, options, getCredsOptional)
    return
  }
  const inner = ctx.isolate(TRADING_RU_MARKET_DATA_KEY)
  const service = new TBankMarketDataService(inner, options, getCredsOptional)
  ctx.effect(() => registry.register(MARKET, ROUTER_PROVIDER, service))

  const tradeRegistry = resolveTradeRegistry(ctx)
  if (tradeRegistry !== undefined) {
    const tradeInner = ctx.isolate(TRADING_TRADE_KEY)
    const trade = new TBankTradeService(tradeInner, { ...options, config }, getCredsRequired)
    ctx.effect(() => tradeRegistry.register(MARKET, ROUTER_PROVIDER, trade))
  }
}
