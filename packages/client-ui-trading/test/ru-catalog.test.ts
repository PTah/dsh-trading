import { describe, expect, it } from 'vitest'
import { groupRuCatalog } from '../src/client/ru-catalog.ts'

describe('groupRuCatalog', () => {
  it('Agent: splits the Russia list into shares, funds, and bonds', () => {
    // Given a mixed MOEX roster
    const rows = [
      { symbol: 'SBER', name: 'Сбербанк', listing: 'share' as const },
      { symbol: 'TMOS', name: 'Т-Капитал Индекс МосБиржи', listing: 'fund' as const },
      { symbol: 'SU26238RMFS4', name: 'ОФЗ 26238', listing: 'bond' as const },
      { symbol: 'GAZP', name: 'Газпром' },
    ]
    // When the sidebar groups it and the user types a ticker
    const all = groupRuCatalog(rows, '')
    const found = groupRuCatalog(rows, 'сбер')
    // Then each section keeps its own names, and a search does not leak into other sections
    expect(all.share.map((row) => row.symbol)).toEqual(['SBER', 'GAZP'])
    expect(all.fund.map((row) => row.symbol)).toEqual(['TMOS'])
    expect(all.bond.map((row) => row.symbol)).toEqual(['SU26238RMFS4'])
    expect(found.share.map((row) => row.symbol)).toEqual(['SBER'])
    expect(found.fund).toHaveLength(0)
    expect(found.bond).toHaveLength(0)
  })
})
