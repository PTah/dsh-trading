/**
 * T-Bank Invest 连接器（dsh-trading ru 切片）：MarketDataService 与 TradeService。
 *
 * 凭证：单一 Invest API token（TBANK_TOKEN / TBANK_DEMO_TOKEN）。
 * Host：demo → sandbox-invest-public-api；live → invest-public-api。
 * 闸门：dry-run 缺省 + liveTrading 须人工签署授权平面（@dshtrading/authority）。
 *
 * @module @dshtrading/connector-tbank
 */

import { liveTradingEnabled } from '@dshtrading/authority'
import {
  OrderIntentLedger,
  deriveVenueClientKey,
  orderFromReceipt,
  receiptFromOrder,
  type OrderIntentPayload,
} from '@dshtrading/authority/order-intents'
import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'
import type {
  AccountBalance,
  Disposable,
  InstrumentRef,
  Interval,
  Kline,
  MarketDataService,
  Order,
  OrderRequest,
  Orderbook,
  Position,
  Ticker,
  TradeService,
} from '@dshtrading/api'
import {
  INTERVAL_VOCABULARY,
  TBANK_ORDER_ID_RULE,
  TBankRestClient,
  TradingServiceError,
  type TBankCredentials,
  type TBankRestOptions,
  normalizeRuSymbol,
} from './rest.js'

export * from './rest.js'

export const name = 'dsh-trading-ru-connector-tbank'

/**
 * 流动性足够、脚本可扫的 MOEX 股票（TQBR）。T-Bank Shares 全量名册太大且要分页，
 * 选股器只需要这份稳定子集；符号仍走 FindInstrument。
 */
export const RU_LIQUID_SHARES: readonly { symbol: string; name: string }[] = [
  { symbol: 'SBER', name: 'Сбербанк' },
  { symbol: 'SBERP', name: 'Сбербанк-п' },
  { symbol: 'GAZP', name: 'Газпром' },
  { symbol: 'LKOH', name: 'Лукойл' },
  { symbol: 'GMKN', name: 'Норникель' },
  { symbol: 'NVTK', name: 'Новатэк' },
  { symbol: 'ROSN', name: 'Роснефть' },
  { symbol: 'TATN', name: 'Татнефть' },
  { symbol: 'TATNP', name: 'Татнефть-п' },
  { symbol: 'SNGS', name: 'Сургутнефтегаз' },
  { symbol: 'SNGSP', name: 'Сургутнефтегаз-п' },
  { symbol: 'CHMF', name: 'Северсталь' },
  { symbol: 'NLMK', name: 'НЛМК' },
  { symbol: 'MAGN', name: 'ММК' },
  { symbol: 'ALRS', name: 'АЛРОСА' },
  { symbol: 'PLZL', name: 'Полюс' },
  { symbol: 'MTSS', name: 'МТС' },
  { symbol: 'MGNT', name: 'Магнит' },
  { symbol: 'PHOR', name: 'ФосАгро' },
  { symbol: 'IRAO', name: 'Интер РАО' },
  { symbol: 'MOEX', name: 'Мосбиржа' },
  { symbol: 'VTBR', name: 'ВТБ' },
  { symbol: 'AFLT', name: 'Аэрофлот' },
  { symbol: 'YDEX', name: 'Яндекс' },
  { symbol: 'OZON', name: 'Озон' },
  { symbol: 'T', name: 'Т-Технологии' },
  { symbol: 'POSI', name: 'Positive Technologies' },
  { symbol: 'FIVE', name: 'X5' },
]

export function ruLiquidInstruments(): InstrumentRef[] {
  return RU_LIQUID_SHARES.map((row) => ({
    symbol: row.symbol,
    name: row.name,
    form: 'spot',
    assetClass: 'equity',
    listing: 'share',
  }))
}

export interface Config {
  enabled: boolean
  env: 'demo' | 'live'
  dryRun: boolean
  liveTrading: boolean
  /** 实盘 token 环境变量名 */
  tokenRef: string
  /** 沙箱 token 环境变量名（可与实盘相同；host 仍按 env 分流） */
  demoTokenRef: string
  /** 可选：显式账户 id；空则 GetAccounts 取第一个 OPEN 账户 */
  accountId: string
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(false),
  env: Schema.union(['demo', 'live']).default('demo'),
  dryRun: Schema.boolean().default(true),
  liveTrading: Schema.boolean().default(false),
  tokenRef: Schema.string().default('TBANK_TOKEN'),
  demoTokenRef: Schema.string().default('TBANK_DEMO_TOKEN'),
  accountId: Schema.string().default(''),
})

export const inject = ['tools']

export const TRADING_RU_MARKET_DATA_KEY = 'tradingRuMarketData'
export const TRADING_TRADE_KEY = 'tradingRuTrade'
export const TRADING_MARKET_DATA_KEY = TRADING_RU_MARKET_DATA_KEY

export const ROUTER_PROVIDER = 'tbank'

export const TBANK_INTENT_ACCOUNT = 'default'

export interface CredentialResolverLike {
  resolve(ref: string): Promise<{ value: string } | undefined>
}

const CREDENTIAL_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

export interface CredentialsContext {
  get(name: string): unknown
}

export interface ResolvedCredentialRefs {
  readonly tokenRef: string
}

export function credentialRefsFor(config: Config, env: 'demo' | 'live' = config.env): ResolvedCredentialRefs {
  return { tokenRef: env === 'demo' ? config.demoTokenRef : config.tokenRef }
}

export async function resolveCredentials(
  ctx: CredentialsContext,
  refs: ResolvedCredentialRefs,
  env: 'demo' | 'live',
): Promise<TBankCredentials | undefined> {
  const router = (ctx.get('tradingMarketRouter') as { getCredential?(p: string): Record<string, string> | undefined } | undefined) ?? undefined
  const routerCreds = router?.getCredential?.('tbank')

  const resolver = ctx.get('credentials') as CredentialResolverLike | undefined
  const hasSeam = resolver !== undefined && typeof resolver.resolve === 'function'

  const readRef = async (ref: string): Promise<string | undefined> => {
    if (!CREDENTIAL_REF_PATTERN.test(ref)) return undefined
    if (routerCreds && typeof routerCreds[ref] === 'string' && routerCreds[ref]) {
      return routerCreds[ref]
    }
    if (hasSeam) {
      const hit = await resolver.resolve(ref)
      return hit?.value
    }
    const ambient = process.env[ref]
    return ambient && ambient.length > 0 ? ambient : undefined
  }

  // settings 卡片常用裸 key `token`
  const fromSettings = routerCreds?.token || routerCreds?.[refs.tokenRef]
  const token = (typeof fromSettings === 'string' && fromSettings) || (await readRef(refs.tokenRef))
  if (!token) {
    if (hasSeam) {
      throw new TradingServiceError(
        'TRADING_AUTH_FAILED',
        `T-Bank credentials seam present but ${refs.tokenRef} is empty (env=${env}); refusing ambient process.env fallback`,
      )
    }
    return undefined
  }
  return { token }
}

function restOptionsFor(config: Config): TBankRestOptions {
  return {
    env: config.env,
    ...(config.accountId.trim() ? { accountId: config.accountId.trim() } : {}),
  }
}

export class TBankMarketDataService extends Service implements MarketDataService {
  private readonly client: TBankRestClient
  private readonly getCredentials: () => Promise<TBankCredentials | undefined>

  constructor(
    ctx: Context,
    options: TBankRestOptions = {},
    getCredentials: () => Promise<TBankCredentials | undefined> = async () => undefined,
    serviceName: string = TRADING_RU_MARKET_DATA_KEY,
  ) {
    super(ctx, serviceName)
    this.client = new TBankRestClient(options)
    this.getCredentials = getCredentials
  }

  private async requireCreds(): Promise<TBankCredentials> {
    const creds = await this.getCredentials()
    if (!creds) {
      throw new TradingServiceError('TRADING_AUTH_FAILED', 'T-Bank token missing (set TBANK_DEMO_TOKEN / TBANK_TOKEN)')
    }
    return creds
  }

  async getTicker(symbol: string): Promise<Ticker> {
    return this.client.getTicker(symbol, await this.requireCreds())
  }

  async getKlines(symbol: string, interval: Interval = '1d', limit: number = 100): Promise<Kline[]> {
    return this.client.getKlines(symbol, interval, limit, await this.requireCreds())
  }

  async getOrderbook?(symbol: string, depth: number = 10): Promise<Orderbook> {
    return this.client.getOrderbook(symbol, depth, await this.requireCreds())
  }

  async listInstruments(): Promise<InstrumentRef[]> {
    try {
      const listed = await this.client.listMoexCatalog(await this.requireCreds())
      if (listed.length > 0) return listed
    } catch {
      // 没有 token 或网络失败时，侧栏仍显示离线的流动性股票子集。
    }
    return ruLiquidInstruments()
  }

  klineCapabilities?() {
    // 声明「翻页后」可承接的深度（getKlines 按 INTERVAL_MAX_WINDOW_MS 切片聚合）。
    return INTERVAL_VOCABULARY.map((interval) => ({ interval, maxBars: 1500 as const }))
  }

  subscribeTicker(symbol: string, cb: (ticker: Ticker) => void, options?: { intervalMs?: number }): Disposable {
    const ms = Math.max(options?.intervalMs ?? 5_000, 1_000)
    const tick = (): void => {
      void this.getTicker(symbol).then(cb, () => {})
    }
    tick()
    const timer = setInterval(tick, ms)
    return { dispose: () => clearInterval(timer) }
  }
}

export class TBankTradeService extends Service implements TradeService {
  private readonly client: TBankRestClient
  private readonly config: Config
  private readonly getCredentials: () => Promise<TBankCredentials>
  private readonly intents: OrderIntentLedger

  constructor(
    ctx: Context,
    options: TBankRestOptions & { config: Config },
    getCredentials: () => Promise<TBankCredentials>,
    serviceName: string = TRADING_TRADE_KEY,
  ) {
    super(ctx, serviceName)
    this.client = new TBankRestClient(options)
    this.config = options.config
    this.getCredentials = getCredentials
    this.intents = new OrderIntentLedger({
      provider: 'tbank',
      environment: options.config.env,
      account: options.accountId?.trim() || TBANK_INTENT_ACCOUNT,
    })
  }

  async getBalance(): Promise<AccountBalance> {
    return this.client.getBalance(await this.getCredentials())
  }

  async getBalances(): Promise<AccountBalance[]> {
    return [await this.getBalance()]
  }

  async placeOrder(order: OrderRequest): Promise<Order> {
    const requestedDryRun = order.dryRun ?? true
    if (!requestedDryRun && !liveTradingEnabled(this.config.liveTrading)) {
      throw new TradingServiceError(
        'TRADING_LIVE_TRADING_DISABLED',
        `T-Bank TradeService.placeOrder rejected: real execution requested but live-trading authority is off`,
      )
    }
    if (requestedDryRun || this.config.dryRun) {
      return {
        id: `dry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        symbol: normalizeRuSymbol(order.symbol),
        side: order.side,
        type: order.type,
        status: 'filled',
        ...(order.price !== undefined ? { price: order.price } : {}),
        quantity: order.quantity,
        dryRun: true,
        timestamp: Date.now(),
      }
    }
    const canonical = normalizeRuSymbol(order.symbol)
    const payload: OrderIntentPayload = {
      symbol: canonical,
      side: order.side,
      type: order.type,
      quantity: order.quantity,
      ...(order.price !== undefined ? { price: order.price } : {}),
    }
    const decision = await this.intents.begin({ intentId: order.intentId, payload })
    if (decision.action === 'replay') {
      return { ...orderFromReceipt(decision.receipt), status: decision.receipt.status as Order['status'] }
    }
    const clientOrderId = deriveVenueClientKey(decision.intentId, TBANK_ORDER_ID_RULE)
    const creds = await this.getCredentials()
    const placed = await this.client.placeOrder(creds, {
      symbol: order.symbol,
      side: order.side === 'sell' ? 'SELL' : 'BUY',
      type: order.type === 'limit' ? 'LIMIT' : 'MARKET',
      quantity: order.quantity,
      price: order.price,
      orderId: clientOrderId,
    })
    await this.intents.confirm({ intentId: decision.intentId, payload, receipt: receiptFromOrder(placed) })
    return placed
  }

  async cancelOrder(orderId: string, _symbol?: string): Promise<void> {
    if (!liveTradingEnabled(this.config.liveTrading) || this.config.dryRun) {
      throw new TradingServiceError(
        'TRADING_LIVE_TRADING_DISABLED',
        'T-Bank cancelOrder rejected: live cancel requires signed live-trading grant with dryRun=false',
      )
    }
    await this.client.cancelOrder(await this.getCredentials(), orderId)
  }

  async getOrder(_symbol: string, id: string): Promise<Order> {
    return this.client.getOrder(await this.getCredentials(), id)
  }

  async getPositions(): Promise<Position[]> {
    try {
      return await this.client.getPositions(await this.getCredentials())
    } catch {
      return []
    }
  }

  async listOpenOrders(symbol?: string): Promise<Order[]> {
    try {
      return await this.client.listOpenOrders(await this.getCredentials(), symbol)
    } catch {
      return []
    }
  }
}

export interface PlaceOrderArgs {
  readonly symbol: string
  readonly side: 'BUY' | 'SELL'
  readonly type: 'MARKET' | 'LIMIT'
  readonly quantity: number
  readonly price?: number
  readonly dryRun?: boolean
  readonly intentId?: string
}

export type OrderGateVerdict =
  | { action: 'reject'; code: 'TRADING_LIVE_TRADING_DISABLED'; message: string }
  | { action: 'simulate' }
  | { action: 'live' }

export function evaluateOrderGate(config: Config, args: PlaceOrderArgs): OrderGateVerdict {
  const requestedDryRun = args.dryRun ?? true
  if (!requestedDryRun && !liveTradingEnabled(config.liveTrading)) {
    return {
      action: 'reject',
      code: 'TRADING_LIVE_TRADING_DISABLED',
      message:
        `ru_place_order rejected: real execution requested (dryRun=${String(args.dryRun)}) `
        + 'but live trading is disabled (no signed live-trading grant). Keep dryRun=true or sign a grant.',
    }
  }
  if (requestedDryRun || config.dryRun) return { action: 'simulate' }
  return { action: 'live' }
}

export function createPlaceOrderTool(deps: {
  marketData: Pick<MarketDataService, 'getTicker'>
  trade?: TradeService
  config: Config
}) {
  return defineTool({
    name: 'ru_place_order',
    description:
      'Place or simulate a MOEX order via T-Bank Invest API. quantity is shares (not lots); '
      + 'the connector floors to whole lots. dryRun defaults to true.',
    parameters: {
      symbol: { type: 'string', required: true, description: 'MOEX symbol, e.g. SBER or SBER.TQBR' },
      side: { type: 'string', enum: ['BUY', 'SELL'], required: true },
      type: { type: 'string', enum: ['MARKET', 'LIMIT'], required: true },
      quantity: { type: 'number', required: true, description: 'Number of shares (> 0); converted to lots server-side' },
      price: { type: 'number', description: 'Limit price; required when type=LIMIT' },
      dryRun: { type: 'boolean', default: true, description: 'Simulate only (default true)' },
      intentId: {
        type: 'string',
        description: 'Stable idempotency id required when dryRun=false (max 36 chars after hashing)',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(raw) {
      const args = raw as PlaceOrderArgs
      const verdict = evaluateOrderGate(deps.config, args)
      if (verdict.action === 'reject') {
        return JSON.stringify({ status: 'rejected', code: verdict.code, message: verdict.message })
      }
      if (verdict.action === 'simulate' || !deps.trade) {
        let referencePrice: number | undefined
        try {
          referencePrice = (await deps.marketData.getTicker(args.symbol)).price
        } catch {
          // ignore
        }
        return JSON.stringify({
          status: 'filled',
          dryRun: true,
          id: `dry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          symbol: normalizeRuSymbol(args.symbol),
          side: args.side.toLowerCase(),
          type: args.type.toLowerCase(),
          quantity: args.quantity,
          ...(args.price ? { price: args.price } : {}),
          referencePrice,
          timestamp: Date.now(),
        })
      }
      const order = await deps.trade.placeOrder({
        symbol: args.symbol,
        side: args.side === 'SELL' ? 'sell' : 'buy',
        type: args.type === 'LIMIT' ? 'limit' : 'market',
        quantity: args.quantity,
        price: args.price,
        ...(args.intentId !== undefined ? { intentId: args.intentId } : {}),
        dryRun: false,
      })
      return JSON.stringify(order)
    },
  })
}

export function createCancelOrderTool(deps: { trade?: TradeService; config: Config }) {
  return defineTool({
    name: 'ru_cancel_order',
    description: 'Cancel an open T-Bank order. Live-only; requires signed live-trading grant.',
    parameters: {
      orderId: { type: 'string', required: true, description: 'Exchange order id' },
      symbol: { type: 'string', description: 'Optional symbol for logging' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(raw) {
      const args = raw as { orderId: string; symbol?: string }
      if (!liveTradingEnabled(deps.config.liveTrading) || deps.config.dryRun || !deps.trade) {
        return JSON.stringify({
          status: 'rejected',
          code: 'TRADING_LIVE_TRADING_DISABLED',
          message: 'ru_cancel_order requires liveTrading grant and dryRun=false',
        })
      }
      await deps.trade.cancelOrder(args.orderId, args.symbol)
      return JSON.stringify({ status: 'canceled', orderId: args.orderId })
    },
  })
}

function createReadTools(deps: {
  marketData: TBankMarketDataService
  trade?: TBankTradeService
}) {
  return [
    defineTool({
      name: 'ru_get_ticker',
      description: 'Get last price for a MOEX instrument via T-Bank Invest (SBER / SBER.TQBR).',
      parameters: {
        symbol: { type: 'string', required: true, description: 'TICKER or TICKER.CLASSCODE' },
      },
      output: {
        schema: { type: 'string' },
        render: (_a, v) => [{ type: 'text', text: v }],
      },
      async execute(raw) {
        const { symbol } = raw as { symbol: string }
        return JSON.stringify(await deps.marketData.getTicker(symbol))
      },
    }),
    defineTool({
      name: 'ru_get_klines',
      description: 'Get historical candles from T-Bank Invest.',
      parameters: {
        symbol: { type: 'string', required: true },
        interval: { type: 'string', enum: INTERVAL_VOCABULARY, default: '1d' },
        limit: { type: 'number', default: 100 },
      },
      output: {
        schema: { type: 'string' },
        render: (_a, v) => [{ type: 'text', text: v }],
      },
      async execute(raw) {
        const args = raw as { symbol: string; interval?: Interval; limit?: number }
        return JSON.stringify(await deps.marketData.getKlines(args.symbol, args.interval ?? '1d', args.limit ?? 100))
      },
    }),
    defineTool({
      name: 'ru_get_orderbook',
      description: 'Get MOEX order book via T-Bank Invest.',
      parameters: {
        symbol: { type: 'string', required: true },
        depth: { type: 'number', default: 10 },
      },
      output: {
        schema: { type: 'string' },
        render: (_a, v) => [{ type: 'text', text: v }],
      },
      async execute(raw) {
        const args = raw as { symbol: string; depth?: number }
        if (!deps.marketData.getOrderbook) {
          return JSON.stringify({ error: 'orderbook unavailable' })
        }
        return JSON.stringify(await deps.marketData.getOrderbook(args.symbol, args.depth ?? 10))
      },
    }),
    defineTool({
      name: 'ru_get_balance',
      description: 'Get T-Bank brokerage cash balances (RUB and others).',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_a, v) => [{ type: 'text', text: v }],
      },
      async execute() {
        if (!deps.trade) return JSON.stringify({ error: 'trade service inactive' })
        return JSON.stringify(await deps.trade.getBalances())
      },
    }),
    defineTool({
      name: 'ru_get_positions',
      description: 'List open security positions on the T-Bank account.',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_a, v) => [{ type: 'text', text: v }],
      },
      async execute() {
        if (!deps.trade) return JSON.stringify([])
        return JSON.stringify(await deps.trade.getPositions())
      },
    }),
  ]
}

export function routeAllows(ctx: Context, config: Config, market: string): boolean {
  if (!config.enabled) return false
  const router = (ctx as unknown as { get?: (key: string, strict?: boolean) => unknown }).get?.(
    'tradingMarketRouter',
    false,
  ) as { activeProvider(m: string): string | undefined } | undefined
  if (!router) return true
  const active = router.activeProvider(market)
  return active === undefined || active === ROUTER_PROVIDER
}

export function apply(ctx: Context, config: Config): void {
  if (!routeAllows(ctx, config, 'ru')) return

  const getCredsOptional = async () => {
    const refs = credentialRefsFor(config)
    return resolveCredentials(ctx, refs, config.env)
  }
  const getCredsRequired = async () => {
    const creds = await getCredsOptional()
    if (!creds) {
      throw new TradingServiceError('TRADING_AUTH_FAILED', 'T-Bank token missing')
    }
    return creds
  }

  const options = restOptionsFor(config)
  const marketData = new TBankMarketDataService(ctx, options, getCredsOptional)
  const trade = new TBankTradeService(ctx, { ...options, config }, getCredsRequired)

  const tools = [
    ...createReadTools({ marketData, trade }),
    createPlaceOrderTool({ marketData, trade, config }),
    createCancelOrderTool({ trade, config }),
  ]
  for (const tool of tools) {
    ctx.tools.register(tool)
  }
}
