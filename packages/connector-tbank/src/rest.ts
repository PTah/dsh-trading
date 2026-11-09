/**
 * T-Bank Invest (ex-Tinkoff) REST 客户端 —— 俄罗斯市场 (ru) 行情与交易数据面。
 *
 * 协议：官方 gRPC 的 REST/Swagger 代理（全部 POST + JSON）。
 * 文档：https://developer.tbank.ru/invest/api · https://tinkoff.github.io/investAPI/
 * OpenAPI：https://tinkoff.github.io/investAPI/swagger-ui/openapi.yaml
 *
 * Host：
 *  - live:    https://invest-public-api.tinkoff.ru/rest
 *  - sandbox: https://sandbox-invest-public-api.tinkoff.ru/rest
 *
 * 鉴权：每个请求 `Authorization: Bearer <token>`（单一 token，无 HMAC）。
 * 符号词汇：`SBER` 或 `SBER.TQBR`（ticker[.classCode]）；内部解析为 instrument uid/figi。
 * 下单 quantity：api 层为「股数」；向交易所提交前按 lot 折算为「手数」并向下取整。
 *
 * @module @dshtrading/connector-tbank/rest
 */

import type {
  AccountBalance,
  Interval,
  Kline,
  Order,
  Orderbook,
  Position,
  Ticker,
  TradingErrorCode,
} from '@dshtrading/api'

export class TradingServiceError extends Error {
  readonly code: TradingErrorCode

  constructor(code: TradingErrorCode, message: string, cause?: unknown) {
    super(message)
    this.name = 'TradingServiceError'
    this.code = code
    if (cause !== undefined) this.cause = cause
  }
}

export interface TBankRestOptions {
  /** REST base（含 /rest）。缺省按 env 选 sandbox/live。 */
  baseUrl?: string
  env?: 'demo' | 'live'
  fetchImpl?: typeof fetch
  timeoutMs?: number
  /** 显式账户 id；缺省首次 GetAccounts 取第一个 OPEN 账户。 */
  accountId?: string
}

/** BYOK：Invest API 只需要一个访问 token。 */
export interface TBankCredentials {
  readonly token: string
}

export interface TBankInstrument {
  readonly uid: string
  readonly figi: string
  readonly ticker: string
  readonly classCode: string
  readonly lot: number
  readonly name: string
  readonly currency: string
  /** 规范符号：TICKER 或 TICKER.CLASSCODE */
  readonly symbol: string
}

type JsonRecord = Record<string, unknown>

const SERVICE = 'tinkoff.public.invest.api.contract.v1'

export const LIVE_REST_BASE = 'https://invest-public-api.tinkoff.ru/rest'
export const SANDBOX_REST_BASE = 'https://sandbox-invest-public-api.tinkoff.ru/rest'

/** CandleInterval 枚举（OpenAPI v1CandleInterval）。 */
export const INTERVAL_TO_TBANK: Record<Interval, string> = {
  '1m': 'CANDLE_INTERVAL_1_MIN',
  '5m': 'CANDLE_INTERVAL_5_MIN',
  '15m': 'CANDLE_INTERVAL_15_MIN',
  '30m': 'CANDLE_INTERVAL_30_MIN',
  '1h': 'CANDLE_INTERVAL_HOUR',
  '4h': 'CANDLE_INTERVAL_4_HOUR',
  '1d': 'CANDLE_INTERVAL_DAY',
  '1w': 'CANDLE_INTERVAL_WEEK',
  '1M': 'CANDLE_INTERVAL_MONTH',
}

const INTERVAL_MS: Record<Interval, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
  '1w': 7 * 24 * 60 * 60_000,
  '1M': 30 * 24 * 60 * 60_000,
}

export const INTERVAL_VOCABULARY = Object.keys(INTERVAL_TO_TBANK) as Interval[]

/** order_id 幂等键：UID，最大 36 字符（PostOrder.orderId）。 */
export const TBANK_ORDER_ID_RULE = { prefix: 'dsht', maxLength: 36 } as const

export function quotationToNumber(q: unknown): number {
  if (!q || typeof q !== 'object') return 0
  const o = q as { units?: string | number; nano?: number }
  const units = typeof o.units === 'string' ? Number(o.units) : Number(o.units ?? 0)
  const nano = Number(o.nano ?? 0)
  if (!Number.isFinite(units) || !Number.isFinite(nano)) return 0
  return units + nano / 1_000_000_000
}

export function numberToQuotation(value: number): { units: string; nano: number } {
  if (!Number.isFinite(value)) {
    throw new TradingServiceError('TRADING_EXCHANGE_ERROR', `T-Bank: invalid price ${value}`)
  }
  const sign = value < 0 ? -1 : 1
  const abs = Math.abs(value)
  const units = Math.trunc(abs) * sign
  const nano = Math.round((abs - Math.trunc(abs)) * 1_000_000_000) * sign
  return { units: String(units), nano }
}

export function normalizeRuSymbol(raw: string): string {
  const s = raw.trim().toUpperCase()
  if (!/^[A-Z0-9]{1,20}(\.[A-Z0-9]{1,12})?$/.test(s)) {
    throw new TradingServiceError(
      'TRADING_UNSUPPORTED_SYMBOL',
      `T-Bank: malformed RU symbol ${JSON.stringify(raw)} (expected TICKER or TICKER.CLASSCODE)`,
    )
  }
  return s
}

function splitSymbol(symbol: string): { ticker: string; classCode?: string } {
  const [ticker, classCode] = symbol.split('.', 2)
  return classCode ? { ticker, classCode } : { ticker }
}

function mapOrderStatus(status: string | undefined): Order['status'] {
  switch (status) {
    case 'EXECUTION_REPORT_STATUS_FILL':
      return 'filled'
    case 'EXECUTION_REPORT_STATUS_REJECTED':
      return 'rejected'
    case 'EXECUTION_REPORT_STATUS_CANCELLED':
      return 'canceled'
    case 'EXECUTION_REPORT_STATUS_PARTIALLYFILL':
      return 'partially_filled'
    case 'EXECUTION_REPORT_STATUS_NEW':
    default:
      return 'open'
  }
}

function mapDirection(direction: string | undefined): Order['side'] {
  return direction === 'ORDER_DIRECTION_SELL' ? 'sell' : 'buy'
}

function mapOrderType(orderType: string | undefined): Order['type'] {
  return orderType === 'ORDER_TYPE_LIMIT' ? 'limit' : 'market'
}

export class TBankRestClient {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private readonly configuredAccountId: string | undefined
  private cachedAccountId: string | undefined
  private readonly instrumentCache = new Map<string, TBankInstrument>()

  constructor(options: TBankRestOptions = {}) {
    const fallback = options.env === 'live' ? LIVE_REST_BASE : SANDBOX_REST_BASE
    this.baseUrl = (options.baseUrl ?? fallback).replace(/\/+$/, '')
    this.fetchImpl = options.fetchImpl ?? fetch
    this.timeoutMs = options.timeoutMs ?? 15_000
    this.configuredAccountId = options.accountId?.trim() || undefined
  }

  private path(service: string, method: string): string {
    return `/${SERVICE}.${service}/${method}`
  }

  private async request(
    service: string,
    method: string,
    body: JsonRecord,
    credentials: TBankCredentials,
  ): Promise<JsonRecord> {
    const url = this.baseUrl + this.path(service, method)
    const controller = new AbortController()
    const timer = setTimeout(
      () => controller.abort(new Error(`request timed out after ${this.timeoutMs}ms`)),
      this.timeoutMs,
    )
    try {
      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          Authorization: `Bearer ${credentials.token}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      let payload: unknown
      try {
        payload = await res.json()
      } catch {
        payload = undefined
      }
      if (!res.ok) {
        const msg = extractErrorMessage(payload) || res.statusText
        if (res.status === 401 || res.status === 403) {
          throw new TradingServiceError('TRADING_AUTH_FAILED', `T-Bank auth failed (${res.status}): ${msg}`)
        }
        if (res.status === 429) {
          throw new TradingServiceError('TRADING_RATE_LIMITED', `T-Bank rate limited (429): ${msg}`)
        }
        if (res.status === 404) {
          throw new TradingServiceError('TRADING_UNSUPPORTED_SYMBOL', `T-Bank not found (404): ${msg}`)
        }
        throw new TradingServiceError('TRADING_EXCHANGE_ERROR', `T-Bank HTTP ${res.status}: ${msg}`)
      }
      if (payload && typeof payload === 'object' && 'code' in (payload as object) && 'message' in (payload as object)
        && !('orderId' in (payload as object)) && !('instruments' in (payload as object))
        && !('lastPrices' in (payload as object)) && !('candles' in (payload as object))
        && !('accounts' in (payload as object)) && !('positions' in (payload as object))) {
        // grpc-gateway rpcStatus 形错误偶发 200
        const msg = extractErrorMessage(payload)
        throw new TradingServiceError('TRADING_EXCHANGE_ERROR', `T-Bank RPC error: ${msg}`)
      }
      return (payload ?? {}) as JsonRecord
    } catch (error) {
      if (error instanceof TradingServiceError) throw error
      throw new TradingServiceError(
        'TRADING_NETWORK',
        error instanceof Error ? error.message : String(error),
        error,
      )
    } finally {
      clearTimeout(timer)
    }
  }

  async resolveAccountId(credentials: TBankCredentials): Promise<string> {
    if (this.configuredAccountId) return this.configuredAccountId
    if (this.cachedAccountId) return this.cachedAccountId
    const data = await this.request('UsersService', 'GetAccounts', {}, credentials)
    const accounts = Array.isArray(data.accounts) ? (data.accounts as JsonRecord[]) : []
    const open = accounts.find((a) => String(a.status ?? '') === 'ACCOUNT_STATUS_OPEN') ?? accounts[0]
    const id = typeof open?.id === 'string' ? open.id : undefined
    if (!id) {
      throw new TradingServiceError(
        'TRADING_EXCHANGE_ERROR',
        'T-Bank: no brokerage account found (create a sandbox account or set config.accountId)',
      )
    }
    this.cachedAccountId = id
    return id
  }

  async resolveInstrument(symbol: string, credentials: TBankCredentials): Promise<TBankInstrument> {
    const canonical = normalizeRuSymbol(symbol)
    const cached = this.instrumentCache.get(canonical)
    if (cached) return cached

    const { ticker, classCode } = splitSymbol(canonical)
    const data = await this.request(
      'InstrumentsService',
      'FindInstrument',
      { query: ticker, apiTradeAvailableFlag: true },
      credentials,
    )
    const instruments = Array.isArray(data.instruments) ? (data.instruments as JsonRecord[]) : []
    const match = instruments.find((row) => {
      const t = String(row.ticker ?? '').toUpperCase()
      const c = String(row.classCode ?? '').toUpperCase()
      if (t !== ticker) return false
      if (classCode && c !== classCode) return false
      return true
    }) ?? instruments.find((row) => String(row.ticker ?? '').toUpperCase() === ticker)

    if (!match) {
      throw new TradingServiceError(
        'TRADING_SYMBOL_NOT_FOUND',
        `T-Bank: instrument not found for ${canonical}`,
      )
    }

    // FindInstrument 不带 lot —— 再拉 ShareBy / GetInstrumentBy
    const uid = String(match.uid ?? '')
    const figi = String(match.figi ?? '')
    let lot = 1
    let name = String(match.name ?? ticker)
    let currency = 'rub'
    if (uid || figi) {
      try {
        const detail = await this.request(
          'InstrumentsService',
          'GetInstrumentBy',
          {
            idType: uid ? 'INSTRUMENT_ID_TYPE_UID' : 'INSTRUMENT_ID_TYPE_FIGI',
            id: uid || figi,
          },
          credentials,
        )
        const inst = (detail.instrument ?? detail) as JsonRecord
        if (typeof inst.lot === 'number' && inst.lot > 0) lot = inst.lot
        if (typeof inst.name === 'string' && inst.name) name = inst.name
        if (typeof inst.currency === 'string' && inst.currency) currency = inst.currency
      } catch {
        // lot 缺省 1：下单时若真实 lot>1，交易所会拒，错误原样抛出
      }
    }

    const resolvedClass = String(match.classCode ?? classCode ?? 'TQBR').toUpperCase()
    const instrument: TBankInstrument = {
      uid: uid || figi,
      figi,
      ticker,
      classCode: resolvedClass,
      lot,
      name,
      currency,
      symbol: resolvedClass && resolvedClass !== 'TQBR' ? `${ticker}.${resolvedClass}` : ticker,
    }
    this.instrumentCache.set(canonical, instrument)
    this.instrumentCache.set(instrument.symbol, instrument)
    if (instrument.uid) this.instrumentCache.set(instrument.uid, instrument)
    if (instrument.figi) this.instrumentCache.set(instrument.figi, instrument)
    return instrument
  }

  async getTicker(symbol: string, credentials: TBankCredentials): Promise<Ticker> {
    const instrument = await this.resolveInstrument(symbol, credentials)
    const [last, book] = await Promise.all([
      this.request(
        'MarketDataService',
        'GetLastPrices',
        { instrumentId: [instrument.uid || instrument.figi] },
        credentials,
      ),
      this.request(
        'MarketDataService',
        'GetOrderBook',
        { instrumentId: instrument.uid || instrument.figi, depth: 1 },
        credentials,
      ).catch(() => null),
    ])

    const prices = Array.isArray(last.lastPrices) ? (last.lastPrices as JsonRecord[]) : []
    const priceRow = prices[0]
    const price = quotationToNumber(priceRow?.price)
    const timestamp = typeof priceRow?.time === 'string' ? Date.parse(priceRow.time) || Date.now() : Date.now()

    let bid: number | undefined
    let ask: number | undefined
    if (book) {
      const bids = Array.isArray(book.bids) ? (book.bids as JsonRecord[]) : []
      const asks = Array.isArray(book.asks) ? (book.asks as JsonRecord[]) : []
      if (bids[0]) bid = quotationToNumber(bids[0].price)
      if (asks[0]) ask = quotationToNumber(asks[0].price)
    }

    return {
      symbol: instrument.symbol,
      price: price || ((bid !== undefined && ask !== undefined) ? (bid + ask) / 2 : 0),
      timestamp,
      ...(bid !== undefined ? { bid } : {}),
      ...(ask !== undefined ? { ask } : {}),
    }
  }

  async getOrderbook(symbol: string, depth: number, credentials: TBankCredentials): Promise<Orderbook> {
    const instrument = await this.resolveInstrument(symbol, credentials)
    const data = await this.request(
      'MarketDataService',
      'GetOrderBook',
      { instrumentId: instrument.uid || instrument.figi, depth: Math.max(1, Math.min(depth, 50)) },
      credentials,
    )
    const mapLevel = (row: JsonRecord) => ({
      price: quotationToNumber(row.price),
      amount: Number(row.quantity ?? 0) * instrument.lot,
    })
    return {
      symbol: instrument.symbol,
      bids: (Array.isArray(data.bids) ? (data.bids as JsonRecord[]) : []).map(mapLevel),
      asks: (Array.isArray(data.asks) ? (data.asks as JsonRecord[]) : []).map(mapLevel),
      timestamp: typeof data.time === 'string' ? Date.parse(data.time) || Date.now() : Date.now(),
    }
  }

  async getKlines(
    symbol: string,
    interval: Interval,
    limit: number,
    credentials: TBankCredentials,
  ): Promise<Kline[]> {
    const instrument = await this.resolveInstrument(symbol, credentials)
    const candleInterval = INTERVAL_TO_TBANK[interval]
    if (!candleInterval) {
      throw new TradingServiceError('TRADING_UNSUPPORTED_INTERVAL', `T-Bank: unsupported interval ${interval}`)
    }
    const capped = Math.max(1, Math.min(limit, 1500))
    const to = Date.now()
    const from = to - capped * INTERVAL_MS[interval]
    const data = await this.request(
      'MarketDataService',
      'GetCandles',
      {
        instrumentId: instrument.uid || instrument.figi,
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
        interval: candleInterval,
      },
      credentials,
    )
    const candles = Array.isArray(data.candles) ? (data.candles as JsonRecord[]) : []
    return candles.slice(-capped).map((c) => ({
      timestamp: typeof c.time === 'string' ? Date.parse(c.time) || 0 : 0,
      open: quotationToNumber(c.open),
      high: quotationToNumber(c.high),
      low: quotationToNumber(c.low),
      close: quotationToNumber(c.close),
      volume: Number(c.volume ?? 0),
    }))
  }

  async getBalance(credentials: TBankCredentials): Promise<AccountBalance> {
    const accountId = await this.resolveAccountId(credentials)
    const data = await this.request(
      'OperationsService',
      'GetPositions',
      { accountId },
      credentials,
    )
    const moneys = Array.isArray(data.money) ? (data.money as JsonRecord[]) : []
    const rub = moneys.find((m) => String(m.currency ?? '').toLowerCase() === 'rub') ?? moneys[0]
    const free = quotationToNumber(rub)
    const currency = String(rub?.currency ?? 'rub').toUpperCase()
    return {
      asset: currency,
      free,
      locked: 0,
    }
  }

  async getPositions(credentials: TBankCredentials): Promise<Position[]> {
    const accountId = await this.resolveAccountId(credentials)
    const data = await this.request(
      'OperationsService',
      'GetPositions',
      { accountId },
      credentials,
    )
    const securities = Array.isArray(data.securities) ? (data.securities as JsonRecord[]) : []
    const out: Position[] = []
    for (const row of securities) {
      const balance = Number(row.balance ?? 0)
      if (!balance) continue
      const figi = String(row.figi ?? '')
      let symbol = figi
      try {
        const inst = await this.resolveInstrument(figi || String(row.instrumentUid ?? ''), credentials)
        symbol = inst.symbol
      } catch {
        // keep figi
      }
      out.push({
        symbol,
        side: balance >= 0 ? 'long' : 'short',
        size: Math.abs(balance),
        entryPrice: 0,
      })
    }
    return out
  }

  async placeOrder(
    credentials: TBankCredentials,
    order: {
      symbol: string
      side: 'BUY' | 'SELL'
      type: 'MARKET' | 'LIMIT'
      /** 股数（不是手数） */
      quantity: number
      price?: number
      orderId: string
    },
  ): Promise<Order> {
    const instrument = await this.resolveInstrument(order.symbol, credentials)
    const accountId = await this.resolveAccountId(credentials)
    if (!(order.quantity > 0) || !Number.isFinite(order.quantity)) {
      throw new TradingServiceError('TRADING_EXCHANGE_ERROR', 'T-Bank: quantity must be a positive number of shares')
    }
    const lots = Math.floor(order.quantity / instrument.lot)
    if (lots < 1) {
      throw new TradingServiceError(
        'TRADING_EXCHANGE_ERROR',
        `T-Bank: quantity ${order.quantity} is below one lot (lot=${instrument.lot}) for ${instrument.symbol}`,
      )
    }
    const body: JsonRecord = {
      quantity: String(lots),
      direction: order.side === 'SELL' ? 'ORDER_DIRECTION_SELL' : 'ORDER_DIRECTION_BUY',
      accountId,
      orderType: order.type === 'LIMIT' ? 'ORDER_TYPE_LIMIT' : 'ORDER_TYPE_MARKET',
      orderId: order.orderId.slice(0, TBANK_ORDER_ID_RULE.maxLength),
      instrumentId: instrument.uid || instrument.figi,
    }
    if (order.type === 'LIMIT') {
      if (order.price === undefined) {
        throw new TradingServiceError('TRADING_EXCHANGE_ERROR', 'T-Bank: LIMIT order requires price')
      }
      body.price = numberToQuotation(order.price)
    }
    const data = await this.request('OrdersService', 'PostOrder', body, credentials)
    const orderId = String(data.orderId ?? '')
    if (!orderId) {
      throw new TradingServiceError('TRADING_EXCHANGE_ERROR', 'T-Bank: PostOrder returned empty orderId')
    }
    return {
      id: orderId,
      symbol: instrument.symbol,
      side: order.side === 'SELL' ? 'sell' : 'buy',
      type: order.type === 'LIMIT' ? 'limit' : 'market',
      status: mapOrderStatus(String(data.executionReportStatus ?? '')),
      ...(order.price !== undefined ? { price: order.price } : {}),
      quantity: lots * instrument.lot,
      timestamp: Date.now(),
    }
  }

  async cancelOrder(credentials: TBankCredentials, orderId: string): Promise<void> {
    const accountId = await this.resolveAccountId(credentials)
    try {
      await this.request('OrdersService', 'CancelOrder', { accountId, orderId }, credentials)
    } catch (error) {
      // 已终态视作成功（撤单语义 = 确保不再成交）
      if (error instanceof TradingServiceError && /cancel|cancelled|canceled|исполнен|отмен/i.test(error.message)) {
        return
      }
      throw error
    }
  }

  async getOrder(credentials: TBankCredentials, orderId: string): Promise<Order> {
    const accountId = await this.resolveAccountId(credentials)
    const data = await this.request(
      'OrdersService',
      'GetOrderState',
      { accountId, orderId },
      credentials,
    )
    const figi = String(data.figi ?? '')
    let symbol = figi
    try {
      if (figi) symbol = (await this.resolveInstrument(figi, credentials)).symbol
    } catch {
      // keep figi
    }
    const lotsRequested = Number(data.lotsRequested ?? 0)
    return {
      id: String(data.orderId ?? orderId),
      symbol,
      side: mapDirection(String(data.direction ?? '')),
      type: mapOrderType(String(data.orderType ?? '')),
      status: mapOrderStatus(String(data.executionReportStatus ?? '')),
      price: quotationToNumber(data.initialSecurityPrice ?? data.averagePositionPrice),
      quantity: lotsRequested,
      timestamp: typeof data.orderDate === 'string' ? Date.parse(data.orderDate) || Date.now() : Date.now(),
    }
  }

  async listOpenOrders(credentials: TBankCredentials, symbol?: string): Promise<Order[]> {
    const accountId = await this.resolveAccountId(credentials)
    const data = await this.request('OrdersService', 'GetOrders', { accountId }, credentials)
    const orders = Array.isArray(data.orders) ? (data.orders as JsonRecord[]) : []
    const mapped: Order[] = []
    for (const row of orders) {
      const figi = String(row.figi ?? '')
      let sym = figi
      try {
        if (figi) sym = (await this.resolveInstrument(figi, credentials)).symbol
      } catch {
        // keep
      }
      if (symbol && normalizeRuSymbol(symbol) !== normalizeRuSymbol(sym) && figi !== symbol) continue
      mapped.push({
        id: String(row.orderId ?? ''),
        symbol: sym,
        side: mapDirection(String(row.direction ?? '')),
        type: mapOrderType(String(row.orderType ?? '')),
        status: mapOrderStatus(String(row.executionReportStatus ?? '')),
        price: quotationToNumber(row.initialSecurityPrice),
        quantity: Number(row.lotsRequested ?? 0),
        timestamp: typeof row.orderDate === 'string' ? Date.parse(row.orderDate) || Date.now() : Date.now(),
      })
    }
    return mapped
  }
}

function extractErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const o = payload as JsonRecord
  if (typeof o.message === 'string') return o.message
  if (typeof o.error === 'string') return o.error
  if (o.error && typeof o.error === 'object' && typeof (o.error as JsonRecord).message === 'string') {
    return String((o.error as JsonRecord).message)
  }
  try {
    return JSON.stringify(payload)
  } catch {
    return ''
  }
}
