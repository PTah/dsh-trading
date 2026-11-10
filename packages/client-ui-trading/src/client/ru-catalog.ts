import type { InstrumentListing } from '@dshtrading/api'

export const RU_LISTING_ORDER: readonly InstrumentListing[] = ['share', 'fund', 'bond']

export interface RuCatalogRow {
  symbol: string
  name?: string
  listing?: InstrumentListing
}

/** 俄罗斯页签的分组：查询只匹配代码和名称，未知分组归到股票。 */
export function groupRuCatalog<T extends RuCatalogRow>(rows: readonly T[], query: string): Record<InstrumentListing, T[]> {
  const needle = query.trim().toLowerCase()
  const grouped: Record<InstrumentListing, T[]> = { share: [], fund: [], bond: [] }
  for (const row of rows) {
    if (needle !== '' && !row.symbol.toLowerCase().includes(needle) && !(row.name ?? '').toLowerCase().includes(needle)) continue
    const listing = row.listing === 'fund' || row.listing === 'bond' ? row.listing : 'share'
    grouped[listing].push(row)
  }
  return grouped
}
