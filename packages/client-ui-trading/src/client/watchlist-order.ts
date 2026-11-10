/**
 * 自选列表的排序与置顶分区（纯函数：MarketSidebar 渲染与单测共用同一判据）。
 *
 * 判据（2026-11-05 用户裁决，参考富途牛牛）：
 * - 置顶行整体进顶部分区，列表区不再重复出现；
 * - 两个区各自一份排序（列表区 / 置顶区独立）：名称、代码、类型、价格或涨跌幅；
 * - 缺失涨跌幅（报价还没落地/快照无昨收）的行任何方向都排末尾——未知不是「最小涨幅」；
 * - 等值保持存储顺序（显式 index 兜底，不依赖引擎 sort 的稳定性）。
 */
import type { InstrumentListing } from '@dshtrading/api'
import type { Instrument } from './types.ts'
import type { WatchlistSortMode } from './store.ts'

export interface WatchlistOrderInput {
  /** 当前视图的候选行（页签/分组过滤后）。 */
  rows: readonly Instrument[]
  /** 置顶键集（`market:symbol`，host 权威）。 */
  pinned: readonly string[]
  sort: { rows: WatchlistSortMode; pinned: WatchlistSortMode }
  /** 行 → 涨跌幅（undefined = 未知）。 */
  pctOf(row: Instrument): number | undefined
  /** 行 → 最新价（undefined = 未知）。 */
  priceOf?(row: Instrument): number | undefined
  /** 行 → 键（`market:symbol`）。 */
  keyOf(row: Instrument): string
  /** 行 → 展示名（缺省用 symbol）。 */
  nameOf?(row: Instrument): string
  /** 行 → 名册类型；未知排在股票/基金/债券之后。 */
  listingOf?(row: Instrument): InstrumentListing | 'other'
}

export interface WatchlistOrderResult {
  /** 顶部分区（已按 pinned 区排序）。 */
  pinned: Instrument[]
  /** 列表区（已按 rows 区排序，不含置顶行）。 */
  rest: Instrument[]
}

const SORT_CYCLE: readonly WatchlistSortMode[] = ['default', 'name', 'ticker', 'type', 'yield-desc', 'yield-asc']
const TYPE_RANK: Record<InstrumentListing | 'other', number> = { share: 0, fund: 1, bond: 2, other: 3 }

function compareText(left: string, right: string): number {
  return left.localeCompare(right, 'ru', { sensitivity: 'base' })
}

function sortByMode(
  rows: readonly Instrument[],
  mode: WatchlistSortMode,
  pctOf: (row: Instrument) => number | undefined,
  priceOf: (row: Instrument) => number | undefined,
  nameOf: (row: Instrument) => string,
  listingOf: (row: Instrument) => InstrumentListing | 'other',
): Instrument[] {
  const list = [...rows]
  if (mode === 'default' || list.length < 2) return list
  const ranked = list.map((row, index) => ({
    row,
    index,
    pct: pctOf(row),
    price: priceOf(row),
    name: nameOf(row),
    ticker: row.symbol,
    listing: listingOf(row),
  }))
  ranked.sort((left, right) => {
    if (mode === 'name' || mode === 'ticker') {
      const byText = compareText(mode === 'name' ? left.name : left.ticker, mode === 'name' ? right.name : right.ticker)
      return byText === 0 ? left.index - right.index : byText
    }
    if (mode === 'type') {
      const byType = TYPE_RANK[left.listing] - TYPE_RANK[right.listing]
      if (byType !== 0) return byType
      const byName = compareText(left.name, right.name)
      return byName === 0 ? left.index - right.index : byName
    }
    const metric = mode === 'price-desc' || mode === 'price-asc' ? 'price' : 'pct'
    const leftValue = left[metric]
    const rightValue = right[metric]
    if (leftValue === undefined || rightValue === undefined) {
      if (leftValue === undefined && rightValue === undefined) return left.index - right.index
      return leftValue === undefined ? 1 : -1
    }
    if (leftValue === rightValue) return left.index - right.index
    return mode === 'yield-desc' || mode === 'price-desc' ? rightValue - leftValue : leftValue - rightValue
  })
  return ranked.map(entry => entry.row)
}

/** 把候选行拆成「置顶分区 + 列表区」并各自排序。 */
export function orderWatchlistRows(input: WatchlistOrderInput): WatchlistOrderResult {
  const pinnedKeys = new Set(input.pinned)
  const pinnedRows: Instrument[] = []
  const restRows: Instrument[] = []
  for (const row of input.rows) {
    if (pinnedKeys.has(input.keyOf(row))) pinnedRows.push(row)
    else restRows.push(row)
  }
  const nameOf = input.nameOf ?? ((row: Instrument) => row.name?.trim() || row.symbol)
  const listingOf = input.listingOf ?? (() => 'other' as const)
  const priceOf = input.priceOf ?? (() => undefined)
  return {
    pinned: sortByMode(pinnedRows, input.sort.pinned, input.pctOf, priceOf, nameOf, listingOf),
    rest: sortByMode(restRows, input.sort.rows, input.pctOf, priceOf, nameOf, listingOf),
  }
}

/** 表头点击的下一步：как добавлены → имя → тикер → тип → доходность. */
export function nextSortMode(mode: WatchlistSortMode): WatchlistSortMode {
  const index = SORT_CYCLE.indexOf(mode)
  return SORT_CYCLE[(index < 0 ? 0 : index + 1) % SORT_CYCLE.length] ?? 'default'
}
