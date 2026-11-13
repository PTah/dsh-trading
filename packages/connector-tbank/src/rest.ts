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
  InstrumentListing,
  InstrumentRef,
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
  readonly listing: 'share' | 'fund' | 'bond' | 'other'
  readonly sector?: string
  readonly focus?: string
  readonly maturity?: string
  readonly couponsPerYear?: number
}

type JsonRecord = Record<string, unknown>

const SERVICE = 'tinkoff.public.invest.api.contract.v1'

/** MOEX 板块：侧栏「Россия」按股票 / 基金 / 债券分组，而不是自选名单。 */
export const MOEX_LISTING_BOARDS: Record<InstrumentListing, readonly string[]> = {
  share: ['TQBR'],
  fund: ['TQTF', 'TQTD'],
  bond: ['TQOB', 'TQCB', 'TQIR', 'TQOD'],
}

/** 从 InstrumentsService 的 instruments[] 里留下指定板块、可交易的行。 */
export function moexRowsFromInstruments(rows: readonly JsonRecord[], listing: InstrumentListing): InstrumentRef[] {
  const boards = new Set(MOEX_LISTING_BOARDS[listing])
  const seen = new Set<string>()
  const out: InstrumentRef[] = []
  for (const row of rows) {
    const classCode = String(row.classCode ?? '').toUpperCase()
    if (!boards.has(classCode)) continue
    if (row.apiTradeAvailableFlag === false) continue
    const ticker = String(row.ticker ?? '').trim().toUpperCase()
    if (!/^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(ticker) || seen.has(ticker)) continue
    seen.add(ticker)
    const name = String(row.name ?? '').trim()
    out.push({
      symbol: ticker,
      ...(name !== '' ? { name } : {}),
      form: 'spot',
      assetClass: 'equity',
      listing,
    })
  }
  out.sort((a, b) => a.symbol.localeCompare(b.symbol))
  return out
}

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

/**
 * GetCandles 单次请求允许的最大时间窗（官方 FAQ，错误码 30014）。
 * @see https://tinkoff.github.io/investAPI/faq_marketdata/
 */
export const INTERVAL_MAX_WINDOW_MS: Record<Interval, number> = {
  '1m': 1 * 24 * 60 * 60_000,
  '5m': 1 * 24 * 60 * 60_000,
  '15m': 1 * 24 * 60 * 60_000,
  '30m': 2 * 24 * 60 * 60_000,
  '1h': 7 * 24 * 60 * 60_000,
  '4h': 30 * 24 * 60 * 60_000,
  '1d': 365 * 24 * 60 * 60_000,
  '1w': 2 * 365 * 24 * 60 * 60_000,
  '1M': 10 * 365 * 24 * 60 * 60_000,
}

/** 单次 getKlines 最多翻页次数（防上游空响应死循环）。 */
const KLINES_MAX_PAGES = 24

export const INTERVAL_VOCABULARY = Object.keys(INTERVAL_TO_TBANK) as Interval[]

/** 单次 GetCandles 窗口内大约能装下的 bar 数（用于 klineCapabilities）。 */
export function maxBarsForInterval(interval: Interval): number {
  const step = INTERVAL_MS[interval]
  const window = INTERVAL_MAX_WINDOW_MS[interval]
  if (!step || !window) return 1
  return Math.max(1, Math.floor(window / step))
}

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

const BOND_BOARDS = new Set(MOEX_LISTING_BOARDS.bond)

/**
 * Чистая цена облигации у T-Bank приходит в пунктах (1 пункт = 1% номинала).
 * Полный чек = чистая цена в рублях + НКД.
 */
export function bondQuoteFromParts(pricePercent: number, nominal: number, aci: number): {
  nominal: number
  aci: number
  pricePercent: number
  clean: number
  dirty: number
} | undefined {
  if (!(pricePercent > 0) || !(nominal > 0) || !Number.isFinite(aci) || aci < 0) return undefined
  const clean = nominal * pricePercent / 100
  return {
    nominal,
    aci,
    pricePercent,
    clean,
    dirty: clean + aci,
  }
}

export function listingOfClassCode(classCode: string): 'share' | 'fund' | 'bond' | 'other' {
  const code = classCode.toUpperCase()
  if ((MOEX_LISTING_BOARDS.bond as readonly string[]).includes(code)) return 'bond'
  if ((MOEX_LISTING_BOARDS.fund as readonly string[]).includes(code)) return 'fund'
  if ((MOEX_LISTING_BOARDS.share as readonly string[]).includes(code)) return 'share'
  return 'other'
}

/** GetInstrumentBy / BondBy / ShareBy 里能解释「这是什么纸」的字段。 */
export function readInstrumentFacts(row: JsonRecord): {
  sector?: string
  focus?: string
  maturity?: string
  couponsPerYear?: number
} {
  const sectorRaw = typeof row.sector === 'string' ? row.sector.trim() : ''
  const sector = sectorRaw !== '' && !sectorRaw.toUpperCase().includes('UNSPECIFIED') ? sectorRaw : undefined
  const focusRaw = typeof row.focusType === 'string' ? row.focusType.trim() : ''
  const focus = focusRaw !== '' && !focusRaw.toUpperCase().includes('UNSPECIFIED') ? focusRaw : undefined
  const maturityRaw = row.maturityDate
  const maturity = typeof maturityRaw === 'string' && maturityRaw.trim() !== '' ? maturityRaw.trim() : undefined
  const coupons = Number(row.couponQuantityPerYear)
  return {
    ...(sector !== undefined ? { sector } : {}),
    ...(focus !== undefined ? { focus } : {}),
    ...(maturity !== undefined ? { maturity } : {}),
    ...(Number.isInteger(coupons) && coupons > 0 ? { couponsPerYear: coupons } : {}),
  }
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

/** 指数代码不是 T-Bank 可交易标的。在打 FindInstrument 之前拒绝，避免「instrument not found」。 */
const RU_INDEX_TICKERS = new Set(['IMOEX', 'RGBI', 'RTSI', 'MOEX'])

export function assertTradableRuSymbol(symbol: string): string {
  const canonical = normalizeRuSymbol(symbol)
  const ticker = canonical.split('.')[0] ?? canonical
  if (RU_INDEX_TICKERS.has(ticker)) {
    throw new TradingServiceError(
      'TRADING_SYMBOL_NOT_FOUND',
      `${ticker} is a MOEX index, not a T-Bank instrument. Quote a share, fund or bond ticker (for example OZON).`,
    )
  }
  return canonical
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

  /** Shares + Etfs + Bonds，只留 MOEX 板块。单个板块失败不影响其余板块。 */
  async listMoexCatalog(credentials: TBankCredentials): Promise<InstrumentRef[]> {
    const methods: ReadonlyArray<{ method: 'Shares' | 'Etfs' | 'Bonds'; listing: InstrumentListing }> = [
      { method: 'Shares', listing: 'share' },
      { method: 'Etfs', listing: 'fund' },
      { method: 'Bonds', listing: 'bond' },
    ]
    const merged: InstrumentRef[] = []
    const seen = new Set<string>()
    for (const item of methods) {
      try {
        const data = await this.request(
          'InstrumentsService',
          item.method,
          { instrumentStatus: 'INSTRUMENT_STATUS_BASE' },
          credentials,
        )
        const instruments = Array.isArray(data.instruments) ? data.instruments as JsonRecord[] : []
        for (const row of moexRowsFromInstruments(instruments, item.listing)) {
          if (seen.has(row.symbol)) continue
          seen.add(row.symbol)
          merged.push(row)
        }
      } catch (error) {
        if (error instanceof TradingServiceError && error.code === 'TRADING_AUTH_FAILED') throw error
      }
    }
    return merged
  }

  async resolveInstrument(symbol: string, credentials: TBankCredentials): Promise<TBankInstrument> {
    const canonical = assertTradableRuSymbol(symbol)
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
    let facts = readInstrumentFacts(match)
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
        facts = { ...facts, ...readInstrumentFacts(inst) }
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
      listing: listingOfClassCode(resolvedClass),
      ...facts,
    }
    this.instrumentCache.set(canonical, instrument)
    this.instrumentCache.set(instrument.symbol, instrument)
    if (instrument.uid) this.instrumentCache.set(instrument.uid, instrument)
    if (instrument.figi) this.instrumentCache.set(instrument.figi, instrument)
    return instrument
  }

  private async nextCouponPay(instrumentId: string, credentials: TBankCredentials): Promise<number | undefined> {
    if (instrumentId === '') return undefined
    try {
      const data = await this.request(
        'InstrumentsService',
        'GetBondCoupons',
        {
          instrumentId,
          from: new Date().toISOString(),
          to: new Date(Date.now() + 20 * 365 * 24 * 60 * 60 * 1000).toISOString(),
        },
        credentials,
      )
      const events = Array.isArray(data.events) ? data.events as JsonRecord[] : []
      const pay = quotationToNumber(events[0]?.payOneBond)
      return pay > 0 ? pay : undefined
    } catch {
      return undefined
    }
  }

  async getTicker(symbol: string, credentials: TBankCredentials): Promise<Ticker> {
    let instrument = await this.resolveInstrument(symbol, credentials)
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

    const lastPrice = price || ((bid !== undefined && ask !== undefined) ? (bid + ask) / 2 : 0)
    let bond: Ticker['bond']
    if (BOND_BOARDS.has(instrument.classCode) && lastPrice > 0) {
      try {
        const detail = await this.request(
          'InstrumentsService',
          'BondBy',
          { idType: 'INSTRUMENT_ID_TYPE_UID', id: instrument.uid },
          credentials,
        )
        const inst = (detail.instrument ?? {}) as JsonRecord
        const nominal = quotationToNumber(inst.nominal)
        const aci = quotationToNumber(inst.aciValue)
        bond = bondQuoteFromParts(lastPrice, nominal, aci)
        const couponPay = await this.nextCouponPay(instrument.uid || instrument.figi, credentials)
        const bondFacts = readInstrumentFacts(inst)
        if (bond !== undefined) {
          bond = {
            ...bond,
            ...(couponPay === undefined ? {} : { couponPay }),
            ...(bondFacts.maturity !== undefined ? { maturity: bondFacts.maturity } : {}),
            ...(bondFacts.couponsPerYear !== undefined ? { couponsPerYear: bondFacts.couponsPerYear } : {}),
          }
        }
        if (bondFacts.maturity !== undefined) instrument = { ...instrument, maturity: bondFacts.maturity }
        if (bondFacts.couponsPerYear !== undefined) instrument = { ...instrument, couponsPerYear: bondFacts.couponsPerYear }
        if (typeof inst.name === 'string' && inst.name.trim() !== '') instrument = { ...instrument, name: inst.name.trim() }
      } catch {
        bond = undefined
      }
    }

    const humanName = instrument.name.trim()
    const name = humanName !== '' && humanName.toUpperCase() !== instrument.ticker.toUpperCase() ? humanName : undefined
    return {
      symbol: instrument.symbol,
      price: lastPrice,
      timestamp,
      ...(name !== undefined ? { name } : {}),
      ...(bid !== undefined ? { bid } : {}),
      ...(ask !== undefined ? { ask } : {}),
      ...(bond !== undefined ? { bond } : {}),
      about: {
        listing: instrument.listing,
        ...(instrument.sector !== undefined ? { sector: instrument.sector } : {}),
        ...(instrument.focus !== undefined ? { focus: instrument.focus } : {}),
        ...(instrument.maturity !== undefined ? { maturity: instrument.maturity } : {}),
        ...(instrument.couponsPerYear !== undefined ? { couponsPerYear: instrument.couponsPerYear } : {}),
        ...(instrument.listing === 'bond' && instrument.ticker.startsWith('SU') ? { ofz: true } : {}),
      },
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
    const stepMs = INTERVAL_MS[interval]
    const maxWindowMs = INTERVAL_MAX_WINDOW_MS[interval]
    if (!stepMs || !maxWindowMs) {
      throw new TradingServiceError('TRADING_UNSUPPORTED_INTERVAL', `T-Bank: unsupported interval ${interval}`)
    }
    // 跨页聚合上限：官方单窗 bar 数有限，GUI 常要 750 根日 K → 必须翻页。
    const capped = Math.max(1, Math.min(limit, 1500))
    const instrumentId = instrument.uid || instrument.figi
    const byOpen = new Map<number, Kline>()
    let cursorTo = Date.now()
    const earliestNeeded = cursorTo - capped * stepMs

    for (let page = 0; page < KLINES_MAX_PAGES && byOpen.size < capped; page += 1) {
      const cursorFrom = Math.max(earliestNeeded, cursorTo - maxWindowMs)
      if (cursorFrom >= cursorTo) break
      const data = await this.request(
        'MarketDataService',
        'GetCandles',
        {
          instrumentId,
          from: new Date(cursorFrom).toISOString(),
          to: new Date(cursorTo).toISOString(),
          interval: candleInterval,
        },
        credentials,
      )
      const candles = Array.isArray(data.candles) ? (data.candles as JsonRecord[]) : []
      if (candles.length === 0) break

      let pageEarliest = Number.POSITIVE_INFINITY
      for (const c of candles) {
        const openTime = typeof c.time === 'string' ? Date.parse(c.time) || 0 : 0
        if (!Number.isFinite(openTime) || openTime <= 0) continue
        pageEarliest = Math.min(pageEarliest, openTime)
        byOpen.set(openTime, {
          openTime,
          open: quotationToNumber(c.open),
          high: quotationToNumber(c.high),
          low: quotationToNumber(c.low),
          close: quotationToNumber(c.close),
          volume: Number(c.volume ?? 0),
          closeTime: openTime + stepMs - 1,
        })
      }
      if (!Number.isFinite(pageEarliest)) break
      // 下一页接到本页最早一根之前，避免重叠整窗空转。
      cursorTo = pageEarliest - 1
      if (cursorTo <= earliestNeeded) break
    }

    return [...byOpen.values()]
      .sort((a, b) => a.openTime - b.openTime)
      .slice(-capped)
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
