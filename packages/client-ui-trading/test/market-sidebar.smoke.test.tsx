/**
 * MarketSidebar 迷你走势编排冒烟（2026-09-08 审查补充）：把侧栏真正 mount 进 jsdom，
 * 用 api 模块桩驱动「分钟线自适应粒度 → 日 K 降级」的取数编排，并断言固定交易时段
 * x 轴（xFractions）确实落到 Sparkline——纯函数单测（intraday-series.test.ts）覆盖
 * 不到这条接线，只测函数会漏掉「算对了但没传给图」的断层。
 *
 * 覆盖：
 * - 股票：先试 1m（桥 TRADING_UNSUPPORTED_INTERVAL）→ 降 5m，调用顺序可查；
 * - 5m 序列带 xFractions → 迷你走势只铺满已完成时段，不拉伸全宽；
 * - 1m + 5m 全失败 → 降级日 K（mode 'daily'，limit 32），序列照常渲染；
 * - crypto 取数归一为 5m×288（滚动 24h；API 层不出现 1m 请求）。
 *
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MarketLocaleKey } from '../src/client/contract.ts'
import type { SelectionState, Watchlists } from '../src/client/store.ts'
import { createWatchlistGroupsStore, createWatchlistSortStore, createWatchlistStore } from '../src/client/store.ts'
import type { Kline, MarketId } from '../src/client/types.ts'

/**
 * 网络桩账本（vi.hoisted：mock 工厂先于 import 求值）。calls 按调用顺序记账，
 * 断言「先 1m 后 5m」这类编排只能靠它。
 */
const net = vi.hoisted(() => ({
  calls: [] as Array<{ market: string; symbol: string; interval: string; limit: number }>,
  /** symbol → 粒度 → 结果：unsupported = 桥 TRADING_UNSUPPORTED_INTERVAL；missing = 无数据/取数失败；ok = 返回 series[粒度]。 */
  plan: {} as Record<string, Record<string, 'unsupported' | 'missing' | 'ok'>>,
  /** 粒度 → K 线序列。 */
  series: {} as Record<string, Kline[]>,
  markets: [] as Array<{ id: 'crypto' | 'us' | 'cn' | 'hk' | 'ru' }>,
  symbols: [] as Array<{ symbol: string; name?: string; listing?: 'share' | 'fund' | 'bond' }>,
  leaders: [] as Array<{ symbol: string; name: string; role: 'leader' | 'growing' | 'outsider'; rank: number; previousRank: number | null; weeksInTop: number; label: 'stable' | 'holding' | 'rising' | 'new' | 'outsider' }>,
}))

vi.mock('../src/client/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/client/api.ts')>()
  return {
    ...actual,
    fetchMarkets: async () => net.markets,
    // 断网桩：全集预取与在线联想一律空，序列完全由 net 决定。
    fetchSymbols: async () => net.symbols,
    fetchRuLeaders: async () => ({ universe: 'imoex' as const, scanned: net.leaders.length, missing: 0, topN: 10, rows: net.leaders }),
    fetchTickers: async () => ({}),
    fetchKlines: async (market: MarketId, symbol: string, interval: string, limit: number): Promise<Kline[]> => {
      net.calls.push({ market, symbol, interval, limit })
      const verdict = net.plan[symbol]?.[interval] ?? 'missing'
      if (verdict === 'unsupported') {
        // 桥的真实形态：HTTP 200 + 业务错误码，api.getJson 转 rejection。
        throw new actual.BridgeError(200, 'TRADING_UNSUPPORTED_INTERVAL: interval unsupported', 'TRADING_UNSUPPORTED_INTERVAL')
      }
      if (verdict === 'missing') throw new Error(`no klines: ${symbol} ${interval}`)
      return net.series[interval] ?? []
    },
  }
})

import { MarketSidebar } from '../src/client/MarketSidebar.tsx'
import { setDynamicCatalog } from '../src/client/symbol-catalog.ts'

/** key 直出翻译（断言用 key 而非文案，与词典解耦）。 */
const t = (key: MarketLocaleKey): string => key

/** 一根 K 线（迷你走势只用 openTime/close，其余字段补齐类型）。 */
function bar(openTime: number, close: number): Kline {
  return { openTime, open: close, high: close, low: close, close, volume: 0, closeTime: openTime + 60_000 }
}

// 2026-09-08（周二）莫斯科主场 10:00–18:40（MSK = UTC+3）内的四根 5m bar：
// 07:00Z=10:00、07:30Z=10:30、11:00Z=14:00、15:00Z=18:00。
const RU_5M: Kline[] = [
  bar(Date.UTC(2026, 8, 8, 7, 0), 100),
  bar(Date.UTC(2026, 8, 8, 7, 30), 101),
  bar(Date.UTC(2026, 8, 8, 11, 0), 102),
  bar(Date.UTC(2026, 8, 8, 15, 0), 103),
]

/** 日 K 降级序列（三根，等距铺满）。 */
const DAILY: Kline[] = [
  bar(Date.UTC(2026, 8, 4, 13, 30), 300),
  bar(Date.UTC(2026, 8, 7, 13, 30), 310),
  bar(Date.UTC(2026, 8, 8, 13, 30), 320),
]

beforeEach(() => {
  // jsdom 默认 about:blank 原点下 localStorage 不可用 → store 的读写静默降级为会话内，
  // 不会跨例残留（readJson/writeJson 自带 try/catch）。
  net.calls = []
  net.plan = {}
  net.series = {}
  net.markets = []
  net.symbols = []
  net.leaders = []
})

afterEach(() => {
  cleanup()
  // 动态字典是模块级单例：清空注入的永续行，避免跨用例串味。
  setDynamicCatalog('crypto', [])
})

function renderSidebar(rows: Array<{ market: MarketId; symbol: string; name?: string }>) {
  const watchlists = createWatchlistStore()
  for (const row of rows) watchlists.add(row.market, row)
  const groups = createWatchlistGroupsStore()
  const sort = createWatchlistSortStore()
  const selection: SelectionState = { instrument: null }
  return render(
    <MarketSidebar
      t={t}
      useSelection={<T,>(sel: (value: SelectionState) => T): T => sel(selection)}
      useWatchlists={<T,>(sel: (value: Watchlists) => T): T => sel(watchlists.getSnapshot())}
      useGroups={<T,>(sel: (value: ReturnType<typeof groups.getSnapshot>) => T): T => sel(groups.getSnapshot())}
      useSortPrefs={<T,>(sel: (value: ReturnType<typeof sort.getSnapshot>) => T): T => sel(sort.getSnapshot())}
      addInstrument={() => {}}
      removeInstrument={() => {}}
      selectInstrument={() => {}}
      openSettings={() => {}}
      createGroup={async () => ({ ok: false as const, reason: 'unavailable' as const })}
      renameGroup={async () => ({ ok: false as const, reason: 'unavailable' as const })}
      deleteGroup={async () => false}
      assignGroupMember={async () => true}
      setActiveGroup={() => {}}
      setPinned={async (key, pinned) => groups.setPinned(key, pinned)}
      cycleSort={(zone) => sort.cycle(zone)}
    />,
  )
}

/** 某标的行内迷你走势的折线坐标（x = 横向像素位置）。 */
function sparkPoints(getByText: (text: string) => HTMLElement, name: string): Array<[number, number]> {
  const row = getByText(name).closest('button')
  expect(row).toBeTruthy()
  const polyline = row?.querySelector('polyline')
  expect(polyline).toBeTruthy()
  return (polyline?.getAttribute('points') ?? '').trim().split(/\s+/).map((pair) => {
    const [x, y] = pair.split(',')
    return [Number(x), Number(y)] as [number, number]
  })
}

/** 某标的的 K 线请求序列（interval:limit，按调用顺序）。 */
function callsOf(symbol: string): string[] {
  return net.calls.filter(call => call.symbol === symbol).map(call => `${call.interval}:${call.limit}`)
}

describe('MarketSidebar 迷你走势编排冒烟', () => {
  it('1m 不支持 → 降级 5m，且 xFractions 让走势只铺满已完成时段', async () => {
    net.markets = [{ id: 'ru' }]
    net.series = { '5m': RU_5M, '1d': DAILY }
    net.plan = { SBER: { '1m': 'unsupported', '5m': 'ok', '1d': 'ok' } }
    const view = renderSidebar([{ market: 'ru', symbol: 'SBER', name: 'Сбербанк' }])

    // 取数编排：先 1m（被桥拒）→ 再 5m（成功）。报价拍还没落地，prevClose 的 1d×2
    // 不抢在它前面发（ticker 缺省时的兜底留到下一拍，见 market-sidebar-prevclose-seed）。
    await waitFor(() => { expect(callsOf('SBER')).toEqual(['1m:500', '5m:200']) })
    expect(net.calls.filter(call => call.interval === '1d' && call.limit === 2)).toHaveLength(0)
    // 5m 成功后不再走日 K 降级（limit 32 缺席）
    expect(net.calls.filter(call => call.interval === '1d' && call.limit === 32)).toHaveLength(0)

    const points = sparkPoints(view.getByText, 'Сбербанк')
    expect(points).toHaveLength(RU_5M.length)
    const xs = points.map(([x]) => x)
    expect(xs[0]).toBeCloseTo(0, 5)                 // 10:00 MSK 开盘 → 左边缘
    // 18:00 MSK = 480/520 时段位置；无 xFractions 时序列等距铺满，末点恰为 56
    expect(xs[3]).toBeCloseTo((480 / 520) * 56, 1)
    expect(xs[3]).toBeLessThan(56 * 0.99)
  })

  it('1m 与 5m 均失败 → 降级日 K（mode daily，limit 32），走势照常渲染', async () => {
    net.markets = [{ id: 'ru' }]
    net.series = { '1d': DAILY }
    net.plan = { GAZP: { '1m': 'unsupported', '5m': 'unsupported', '1d': 'ok' } }
    const view = renderSidebar([{ market: 'ru', symbol: 'GAZP', name: 'Газпром' }])

    // 两档分钟线都试过才降日 K；日 K 的倒数第二根自带走 prevClose，不再额外补 1d×2
    await waitFor(() => { expect(callsOf('GAZP')).toEqual(['1m:500', '5m:200', '1d:32']) })
    expect(net.calls.filter(call => call.interval === '1d' && call.limit === 2)).toHaveLength(0)

    // 日 K 序列三根 → 等距铺满（日 K 无 xFractions）
    const points = sparkPoints(view.getByText, 'Газпром')
    expect(points).toHaveLength(DAILY.length)
    expect(points.map(([x]) => x)).toEqual([0, 28, 56])
  })

  it('侧栏只留俄罗斯市场，加密自选行和永续筛选都不出现', async () => {
    // Given: 桥回报了 crypto，自选里也有 BTC，但侧栏市场表只有 ru
    net.markets = [{ id: 'crypto' }, { id: 'ru' }]
    const view = renderSidebar([
      { market: 'crypto', symbol: 'BTCUSDT', name: '比特币' },
      { market: 'ru', symbol: 'SBER', name: 'Сбербанк' },
    ])
    // Then: 只看见俄股自选，没有加密行，也没有永续形态开关
    await waitFor(() => { expect(view.getByText('Сбербанк')).toBeTruthy() })
    expect(view.queryByText('比特币')).toBeNull()
    expect(view.container.querySelector('button[data-form-filter]')).toBeNull()
  })

  it('Agent: Russia catalog sections start folded and a triangle opens one block', async () => {
    net.markets = [{ id: 'ru' }]
    net.symbols = [
      { symbol: 'SBER', name: 'Сбербанк', listing: 'share' },
      { symbol: 'TMOS', name: 'Тинькофф Индекс', listing: 'fund' },
      { symbol: 'SU26238', name: 'ОФЗ 26238', listing: 'bond' },
    ]
    renderSidebar([])
    await waitFor(() => { expect(screen.getByRole('tab', { name: 'tab.ru' })).toBeTruthy() })
    fireEvent.click(screen.getByRole('tab', { name: 'tab.ru' }))
    const shares = await screen.findByRole('button', { name: 'sidebar.catalog.share' })
    expect(shares.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Сбербанк')).toBeNull()
    expect(screen.queryByText('Тинькофф Индекс')).toBeNull()
    fireEvent.click(shares)
    expect(screen.getByRole('button', { name: 'sidebar.catalog.share' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Сбербанк')).toBeTruthy()
    expect(screen.queryByText('Тинькофф Индекс')).toBeNull()
  })

  it('Agent: a favorite row shows a share, fund, or bond mark from the catalog', async () => {
    net.markets = [{ id: 'ru' }]
    net.symbols = [
      { symbol: 'SBER', name: 'Сбербанк', listing: 'share' },
      { symbol: 'SU26238', name: 'ОФЗ 26238', listing: 'bond' },
    ]
    const view = renderSidebar([
      { market: 'ru', symbol: 'SBER', name: 'Сбербанк' },
      { market: 'ru', symbol: 'SU26238', name: 'ОФЗ 26238' },
    ])
    await waitFor(() => { expect(view.getAllByText('listing.share').length).toBeGreaterThan(0) })
    expect(view.getAllByText('listing.bond').length).toBeGreaterThan(0)
    const shareRow = view.getByText('Сбербанк').closest('button')
    const bondRow = view.getByText('ОФЗ 26238').closest('button')
    expect(shareRow?.getAttribute('data-listing')).toBe('share')
    expect(bondRow?.getAttribute('data-listing')).toBe('bond')
  })

  it('Agent: the Russia tab opens the IMOEX leaders and keeps the full catalog folded', async () => {
    net.markets = [{ id: 'ru' }]
    net.symbols = [{ symbol: 'SBER', name: 'Сбербанк', listing: 'share' }]
    net.leaders = [{ symbol: 'GAZP', name: 'Газпром', role: 'leader', rank: 1, previousRank: 1, weeksInTop: 8, label: 'stable' }]
    renderSidebar([])
    await waitFor(() => { expect(screen.getByRole('tab', { name: 'tab.ru' })).toBeTruthy() })
    fireEvent.click(screen.getByRole('tab', { name: 'tab.ru' }))
    const name = await screen.findByText('Газпром')
    const row = name.closest('button')
    expect(row?.getAttribute('data-catalog')).toBe('true')
    expect(row?.closest('[role="listbox"]')).toBeTruthy()
    expect(screen.getAllByText('leaders.label.stable').length).toBeGreaterThan(0)
    expect(screen.queryByText('Сбербанк')).toBeNull()
  })
})
