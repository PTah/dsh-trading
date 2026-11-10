/**
 * Российские заголовки для рынка ru: Google News RSS на русском (hl=ru, gl=RU).
 * Без ключа и без полного текста статьи. Один источник, ошибка не роняет мост.
 */
import type { AggregateNewsOptions, AggregateNewsResult, NewsItem } from '@dshtrading/api'

const GOOGLE_NEWS_RSS_URL = 'https://news.google.com/rss/search'
const DEFAULT_TOPIC = 'Мосбиржа экономика'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (dsh-trading/ru_news)'
const TIMEOUT_MS = 10_000

function decodeXmlText(raw: string): string {
  return raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, inner: string) => inner)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#([0-9]+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .trim()
}

function extractTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}[\\s>][\\s\\S]*?<\\/${tag}>`, 'i'))
  if (!match) return ''
  return decodeXmlText(match[0].replace(new RegExp(`<\\/?${tag}[^>]*>`, 'gi'), ''))
}

/** Разбор RSS Google News: title, link, pubDate, source. */
export function parseRuNewsRss(xml: string): NewsItem[] {
  const items: NewsItem[] = []
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? []
  for (const block of blocks) {
    const title = extractTag(block, 'title')
    const link = extractTag(block, 'link')
    if (title === '' || link === '') continue
    const ts = Date.parse(extractTag(block, 'pubDate'))
    if (!Number.isFinite(ts)) continue
    const source = extractTag(block, 'source') || 'Google News'
    items.push({ source, title, url: link, publishedAt: new Date(ts).toISOString() })
  }
  return items
}

function clamp(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.trunc(value), min), max)
}

type RuNewsOptions = AggregateNewsOptions & {
  fetch?: typeof globalThis.fetch
  now?: number
}

export async function aggregateNews(options: RuNewsOptions = {}): Promise<AggregateNewsResult> {
  if (options.sources !== undefined && !options.sources.includes('googlenews')) {
    return { items: [], unavailable: [] }
  }
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
  const now = options.now ?? Date.now()
  // Окно шире суток: по одному тикеру за 24 часа русская лента часто пустая.
  const windowHours = Math.max(clamp(options.windowHours, 72, 1, 24 * 7), 72)
  const limit = clamp(options.limit, 20, 1, 50)
  const topic = options.symbol?.trim() ? `${options.symbol.trim()} Мосбиржа` : DEFAULT_TOPIC
  const url = new URL(GOOGLE_NEWS_RSS_URL)
  url.searchParams.set('q', topic)
  url.searchParams.set('hl', 'ru')
  url.searchParams.set('gl', 'RU')
  url.searchParams.set('ceid', 'RU:ru')
  try {
    const response = await fetchImpl(url.toString(), {
      headers: { accept: 'application/rss+xml, text/xml, */*', 'user-agent': UA },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) {
      return { items: [], unavailable: [`googlenews: HTTP ${response.status}`] }
    }
    const xml = await response.text()
    const windowMs = windowHours * 3_600_000
    const items = parseRuNewsRss(xml)
      .filter((item) => {
        const ts = Date.parse(item.publishedAt)
        return Number.isFinite(ts) && ts >= now - windowMs && ts <= now + 60_000
      })
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, limit)
    return { items, unavailable: [] }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { items: [], unavailable: [`googlenews: ${message}`] }
  }
}
