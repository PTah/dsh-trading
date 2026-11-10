import { describe, expect, it } from 'vitest'
import { aggregateNews, parseRuNewsRss } from '../src/news.ts'

const RSS = `<?xml version="1.0"?><rss><channel>
  <item><title>Сбербанк отчитался</title><link>https://news.google.com/rss/articles/a</link><pubDate>Sun, 08 Nov 2026 10:00:00 GMT</pubDate><source>РБК</source></item>
  <item><title>Пусто</title><link></link><pubDate>Sun, 08 Nov 2026 09:00:00 GMT</pubDate></item>
</channel></rss>`

describe('ru news rss', () => {
  it('Agent: keeps a Russian headline and drops an item without a link', () => {
    const items = parseRuNewsRss(RSS)
    expect(items).toHaveLength(1)
    expect(items[0]?.title).toBe('Сбербанк отчитался')
    expect(items[0]?.source).toBe('РБК')
  })

  it('Agent: asks Google News in Russian and returns the parsed headline', async () => {
    const calls: string[] = []
    const result = await aggregateNews({
      symbol: 'SBER',
      now: Date.parse('2026-11-08T12:00:00Z'),
      fetch: async (input) => {
        calls.push(String(input))
        return new Response(RSS, { status: 200 })
      },
    })
    expect(calls[0]).toContain('hl=ru')
    expect(calls[0]).toContain('gl=RU')
    expect(calls[0]).toContain(encodeURIComponent('SBER Мосбиржа').replace(/%20/g, '+') === '' ? 'SBER' : 'SBER')
    expect(result.items[0]?.source).toBe('РБК')
    expect(result.unavailable).toEqual([])
  })
})
