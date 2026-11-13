import { describe, expect, it } from 'vitest'
import { classifyLeaderRoles, constituentsFromRows, fetchIndexConstituents } from '../src/leaders.ts'

function walk(start: number, count: number, daily: number): number[] {
  const closes = [start]
  for (let index = 1; index < count; index += 1) {
    closes.push((closes[index - 1] ?? start) * (1 + daily))
  }
  return closes
}

function flatThenRise(count: number, riseBars: number, daily: number): number[] {
  const closes = Array.from({ length: count - riseBars }, () => 100)
  let price = 100
  for (let index = 0; index < riseBars; index += 1) {
    price *= 1 + daily
    closes.push(price)
  }
  return closes
}

describe('index constituents', () => {
  it('Agent: keeps the latest IMOEX date and the heavier names first', () => {
    const rows = constituentsFromRows([
      { tradedate: '2026-11-08', ticker: 'GAZP', shortnames: 'Газпром', weight: 10 },
      { tradedate: '2026-11-09', ticker: 'SBER', shortnames: 'Сбербанк', weight: 14 },
      { tradedate: '2026-11-09', ticker: 'GAZP', shortnames: 'Газпром', weight: 11 },
      { tradedate: '2026-11-09', ticker: 'SBER', shortnames: 'дубль', weight: 1 },
    ])
    expect(rows.map(row => row.symbol)).toEqual(['SBER', 'GAZP'])
    expect(rows[0]?.name).toBe('Сбербанк')
  })

  it('Agent: pages MOEX ISS until the cursor total is covered', async () => {
    const calls: string[] = []
    const page = (start: number) => ({
      analytics: {
        columns: ['tradedate', 'ticker', 'shortnames', 'weight'],
        data: [[ '2026-11-09', start === 0 ? 'SBER' : 'GAZP', start === 0 ? 'Сбербанк' : 'Газпром', start === 0 ? 14 : 11 ]],
      },
      'analytics.cursor': { columns: ['TOTAL', 'PAGESIZE'], data: [[2, 1]] },
    })
    const rows = await fetchIndexConstituents('imoex', async (input) => {
      calls.push(String(input))
      const start = String(input).includes('start=0') ? 0 : 1
      return new Response(JSON.stringify(page(start)), { status: 200 })
    })
    expect(calls).toHaveLength(2)
    expect(calls[0]).toContain('/IMOEX.json')
    expect(rows.map(row => row.symbol)).toEqual(['SBER', 'GAZP'])
  })
})

describe('leader roles', () => {
  it('Agent: splits a steady leader, a new climber, and a name that stays at the bottom', () => {
    const mild = [0.0005, 0.0004, 0.0003, 0.0002, 0.0001]
    const rows = [
      { symbol: 'LEAD', name: 'Лидер', closes: walk(100, 200, 0.003) },
      { symbol: 'GROW', name: 'Рост', closes: flatThenRise(200, 12, 0.02) },
      ...mild.map((daily, index) => ({
        symbol: `MID${index}`,
        name: `Середина ${index}`,
        closes: walk(100, 200, daily),
      })),
      { symbol: 'DOWN', name: 'Аутсайдер', closes: walk(100, 200, -0.003) },
    ]
    const classified = classifyLeaderRoles(rows, 2)
    const bySymbol = new Map(classified.map(row => [row.symbol, row]))
    expect(bySymbol.get('LEAD')?.role).toBe('leader')
    expect(bySymbol.get('LEAD')?.label).toBe('stable')
    expect(bySymbol.get('GROW')?.role).toBe('growing')
    expect(bySymbol.get('DOWN')?.role).toBe('outsider')
    expect(bySymbol.get('LEAD')?.rank).toBeLessThan(bySymbol.get('DOWN')?.rank ?? 0)
  })
})
