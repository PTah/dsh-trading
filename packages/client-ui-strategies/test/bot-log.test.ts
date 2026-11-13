import { describe, expect, it } from 'vitest'
import { appendBotLog, botLogEntry, failedBotLogEntry, sanitizeBotLog } from '../src/client/bot-log.ts'

describe('bot log', () => {
  it('Agent: keeps the newest check first and drops a corrupt saved row', () => {
    const first = botLogEntry(1_000, 'manual', [
      { symbol: 'ABIO', verdict: 'buy', name: 'Артген' },
      { symbol: 'SU26236', verdict: 'bond-add' },
      { symbol: 'SBER', verdict: 'no-cross' },
    ])
    const second = failedBotLogEntry(2_000, 'auto')
    const saved = appendBotLog([first], second, 2)
    expect(saved.map(row => row.source)).toEqual(['auto', 'manual'])
    expect(saved[1]?.buys).toBe(1)
    expect(saved[1]?.bonds).toBe(1)
    expect(saved[1]?.hits.map(hit => hit.symbol)).toEqual(['ABIO', 'SU26236'])
    expect(appendBotLog(saved, botLogEntry(3_000, 'auto', []), 2)).toHaveLength(2)
    expect(sanitizeBotLog([
      second,
      { at: 'вчера', source: 'auto', ok: true },
      { ...first, hits: [{ symbol: '', verdict: 'buy' }, { symbol: 'TMOS', verdict: 'fund-entry' }] },
    ])).toEqual([
      second,
      { ...first, hits: [{ symbol: 'TMOS', verdict: 'fund-entry' }] },
    ])
  })
})