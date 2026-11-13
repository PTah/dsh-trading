/**
 * Текст новости для вкладки внутри терминала.
 * Ссылка Google News распаковывается до страницы издателя, из HTML берутся абзацы.
 * Это показ уже открытой новости, не поиск и не совет.
 */

const MAX_BYTES = 1_500_000
const MAX_PARAGRAPHS = 12
const MAX_CHARS = 3500

export interface NewsArticle {
  title: string
  sourceHost: string
  paragraphs: string[]
}

function decodeEntities(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/\s+/g, ' ')
    .trim()
}

/** Публичный http(s) адрес. Локальные и частные сети не запрашиваем. */
export function publicNewsUrl(raw: string): URL | undefined {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return undefined
  if (host === '::1' || host === '0.0.0.0') return undefined
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    const a = Number(ipv4[1])
    const b = Number(ipv4[2])
    if (a === 10 || a === 127 || a === 0 || (a === 192 && b === 168) || (a === 169 && b === 254)) return undefined
    if (a === 172 && b >= 16 && b <= 31) return undefined
  }
  return url
}

/** Ссылка вида news.google.com/rss/articles/… часто прячет адрес издателя в base64. */
export function publisherUrl(raw: string): string {
  const url = publicNewsUrl(raw)
  if (url === undefined) return raw.trim()
  const host = url.hostname.toLowerCase()
  if (host !== 'news.google.com') return url.toString()
  const token = url.pathname.split('/articles/')[1]?.split('/')[0] ?? ''
  if (token === '') return url.toString()
  try {
    const padded = token.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - token.length % 4) % 4)
    const bytes = Buffer.from(padded, 'base64').toString('utf8')
    const found = bytes.match(/https?:\/\/[^\s\u0000-\u001f"'<>]+/)
    const publisher = found?.[0]?.replace(/[),.;]+$/, '')
    if (publisher !== undefined && publicNewsUrl(publisher) !== undefined) return publisher
  } catch {
    // остаётся исходная ссылка Google News
  }
  return url.toString()
}

/** Заголовок и абзацы из HTML страницы. Короткий текст меню и подвала отбрасывается. */
export function extractArticleHtml(html: string, fallbackTitle: string): { title: string; paragraphs: string[] } {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
  const article = stripped.match(/<article[\s\S]*?<\/article>/i)?.[0] ?? stripped
  const heading = decodeEntities(article.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '')
  const title = heading !== '' ? heading : fallbackTitle
  const paragraphs: string[] = []
  let used = 0
  for (const match of article.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = decodeEntities(match[1] ?? '')
    if (text.length < 80) continue
    if (used + text.length > MAX_CHARS) break
    paragraphs.push(text)
    used += text.length
    if (paragraphs.length >= MAX_PARAGRAPHS) break
  }
  return { title, paragraphs }
}

export async function readNewsArticle(
  rawUrl: string,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<NewsArticle> {
  const target = publicNewsUrl(publisherUrl(rawUrl))
  if (target === undefined) throw new Error('news article url is not a public http(s) address')
  const response = await fetchImpl(target.toString(), {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (dsh-trading/ru_news)',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(12_000),
  })
  if (!response.ok) throw new Error(`news article HTTP ${response.status}`)
  const html = (await response.text()).slice(0, MAX_BYTES)
  const extracted = extractArticleHtml(html, '')
  return {
    title: extracted.title,
    sourceHost: target.hostname.replace(/^www\./, ''),
    paragraphs: extracted.paragraphs,
  }
}
