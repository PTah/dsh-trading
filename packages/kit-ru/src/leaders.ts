/**
 * Роли бумаг внутри индекса Мосбиржи (IMOEX / RGBI).
 * Импульс — это доходность 3 месяца и 1 месяца против медианы того же списка.
 * Лидер давно в топе, растущий поднимается по месту, аутсайдер весь срок в нижней части.
 * Это описание места в рейтинге, не совет покупать или продавать.
 */

const ISS_ANALYTICS = 'https://iss.moex.com/iss/statistics/engines/stock/markets/index/analytics'
const BARS_1M = 21
const BARS_3M = 63
const STEP = 5
const STEPS = 8
const MIN_SEEN = 4
const TOP_SHARE_FOR_LEADER = 0.6
const BOTTOM_START = 0.6
const CLIMB = 3
const MAX_GROWING = 12
const MAX_OUTSIDERS = 12
const MAX_CONSTITUENTS = 50

export const LEADER_TOP_N = 10

export type LeaderUniverse = 'imoex' | 'rgbi'
export type LeaderRole = 'leader' | 'growing' | 'outsider'
export type LeaderLabel = 'stable' | 'holding' | 'rising' | 'new' | 'outsider'

export interface LeaderConstituent {
  symbol: string
  name: string
  weight: number
}

export interface LeaderSeries {
  symbol: string
  name: string
  /** Дневные закрытия от старых к новым. */
  closes: readonly number[]
}

export interface LeaderRow {
  symbol: string
  name: string
  role: LeaderRole
  rank: number
  previousRank: number | null
  weeksInTop: number
  label: LeaderLabel
}

interface Scored {
  symbol: string
  name: string
  score: number
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
  return sorted[mid] ?? 0
}

function percentReturn(closes: readonly number[], end: number, lookback: number): number | undefined {
  const prev = end - lookback
  if (prev < 0 || end >= closes.length) return undefined
  const base = closes[prev]
  const last = closes[end]
  if (base === undefined || last === undefined || !(base > 0) || !(last > 0)) return undefined
  return (last / base - 1) * 100
}

/** Состав индекса на одном срезе: тикер, короткое имя, вес. Берём последнюю дату. */
export function constituentsFromRows(rows: readonly Record<string, unknown>[]): LeaderConstituent[] {
  let latest = ''
  for (const row of rows) {
    const traded = String(row.tradedate ?? '')
    if (traded > latest) latest = traded
  }
  const seen = new Set<string>()
  const out: LeaderConstituent[] = []
  for (const row of rows) {
    if (latest !== '' && String(row.tradedate ?? '') !== latest) continue
    const symbol = String(row.ticker ?? row.secids ?? '').trim().toUpperCase()
    if (!/^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(symbol) || seen.has(symbol)) continue
    seen.add(symbol)
    const name = String(row.shortnames ?? '').trim()
    const weight = Number(row.weight)
    out.push({
      symbol,
      name: name !== '' ? name : symbol,
      weight: Number.isFinite(weight) ? weight : 0,
    })
  }
  out.sort((left, right) => right.weight - left.weight || left.symbol.localeCompare(right.symbol))
  return out.slice(0, MAX_CONSTITUENTS)
}

export function issTableRows(payload: unknown, tableName: string): Record<string, unknown>[] {
  if (payload === null || typeof payload !== 'object') return []
  const table = (payload as Record<string, unknown>)[tableName]
  if (table === null || typeof table !== 'object') return []
  const columns = (table as { columns?: unknown }).columns
  const data = (table as { data?: unknown }).data
  if (!Array.isArray(columns) || !Array.isArray(data)) return []
  const names = columns.map(column => String(column))
  const rows: Record<string, unknown>[] = []
  for (const item of data) {
    if (!Array.isArray(item)) continue
    const row: Record<string, unknown> = {}
    names.forEach((name, index) => { row[name] = item[index] })
    rows.push(row)
  }
  return rows
}

export async function fetchIndexConstituents(
  indexId: string,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<LeaderConstituent[]> {
  const normalized = indexId.trim().toUpperCase()
  const collected: Record<string, unknown>[] = []
  let start = 0
  let total = Number.POSITIVE_INFINITY
  for (let page = 0; page < 10 && start < total; page += 1) {
    const url = `${ISS_ANALYTICS}/${encodeURIComponent(normalized)}.json?iss.meta=off&start=${start}`
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`MOEX ISS HTTP ${response.status}`)
    const payload: unknown = await response.json()
    const batch = issTableRows(payload, 'analytics')
    if (batch.length === 0) break
    collected.push(...batch)
    const cursor = issTableRows(payload, 'analytics.cursor')[0]
    const cursorTotal = Number(cursor?.TOTAL ?? cursor?.total)
    const pageSize = Number(cursor?.PAGESIZE ?? cursor?.pagesize)
    total = Number.isFinite(cursorTotal) ? cursorTotal : collected.length
    start += Number.isFinite(pageSize) && pageSize > 0 ? pageSize : batch.length
  }
  return constituentsFromRows(collected)
}

function cohort(rows: readonly LeaderSeries[], offset: number): Scored[] {
  const parts: Array<{ symbol: string; name: string; ret3m: number; ret1m: number }> = []
  for (const row of rows) {
    const end = row.closes.length - 1 - offset
    const ret3m = percentReturn(row.closes, end, BARS_3M)
    const ret1m = percentReturn(row.closes, end, BARS_1M)
    if (ret3m === undefined || ret1m === undefined) continue
    parts.push({ symbol: row.symbol, name: row.name, ret3m, ret1m })
  }
  const mid = median(parts.map(part => part.ret3m))
  return parts
    .map(part => ({
      symbol: part.symbol,
      name: part.name,
      score: round2(part.ret3m * 0.45 + part.ret1m * 0.25 + (part.ret3m - mid) * 0.2),
    }))
    .sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol))
}

function rankOf(scored: readonly Scored[]): Map<string, number> {
  const ranks = new Map<string, number>()
  scored.forEach((row, index) => { ranks.set(row.symbol, index + 1) })
  return ranks
}

/**
 * Три роли по истории мест. Срез раз в 5 торговых дней, восемь срезов.
 * Топ — первые topN. Аутсайдер ни разу не входил в топ и обычно в нижних 40%.
 */
export function classifyLeaderRoles(
  rows: readonly LeaderSeries[],
  topN: number = LEADER_TOP_N,
): LeaderRow[] {
  const snapshots = Array.from({ length: STEPS }, (_, step) => cohort(rows, step * STEP))
  const latest = snapshots[0] ?? []
  if (latest.length < 3) return []
  const latestRank = rankOf(latest)
  const previous = snapshots[4] ?? []
  const previousRank = rankOf(previous)
  const names = new Map(rows.map(row => [row.symbol, row.name]))

  const tallies = new Map<string, { seen: number; inTop: number; inBottom: number }>()
  for (const snapshot of snapshots) {
    const ranks = rankOf(snapshot)
    const bottomFrom = Math.floor(snapshot.length * BOTTOM_START)
    for (const [symbol, rank] of ranks) {
      const tally = tallies.get(symbol) ?? { seen: 0, inTop: 0, inBottom: 0 }
      tally.seen += 1
      if (rank <= topN) tally.inTop += 1
      if (rank > bottomFrom) tally.inBottom += 1
      tallies.set(symbol, tally)
    }
  }

  const half = Math.ceil(latest.length / 2)
  const leaders: LeaderRow[] = []
  const growing: LeaderRow[] = []
  const outsiders: LeaderRow[] = []

  for (const row of latest) {
    const tally = tallies.get(row.symbol)
    if (tally === undefined || tally.seen < MIN_SEEN) continue
    const rank = latestRank.get(row.symbol) ?? row.symbol.length
    const prior = previousRank.get(row.symbol) ?? null
    const base = {
      symbol: row.symbol,
      name: names.get(row.symbol) || row.name,
      rank,
      previousRank: prior,
      weeksInTop: tally.inTop,
    }
    const outsider = tally.inTop === 0 && rank > topN && tally.inBottom / tally.seen >= 0.7
    if (outsider) {
      outsiders.push({ ...base, role: 'outsider', label: 'outsider' })
      continue
    }
    if (rank <= topN && tally.inTop / tally.seen >= TOP_SHARE_FOR_LEADER) {
      leaders.push({
        ...base,
        role: 'leader',
        label: tally.inTop >= 6 ? 'stable' : 'holding',
      })
      continue
    }
    const climbed = prior !== null && rank + CLIMB <= prior && rank <= half
    if (climbed) {
      growing.push({
        ...base,
        role: 'growing',
        label: rank <= topN && tally.inTop <= 2 ? 'new' : 'rising',
      })
    }
  }

  leaders.sort((left, right) => left.rank - right.rank)
  growing.sort((left, right) => (right.previousRank ?? right.rank) - right.rank - ((left.previousRank ?? left.rank) - left.rank))
  outsiders.sort((left, right) => right.rank - left.rank)
  return [...leaders, ...growing.slice(0, MAX_GROWING), ...outsiders.slice(0, MAX_OUTSIDERS)]
}
