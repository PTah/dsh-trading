/**
 * 新闻情报流面板：位于 K 线图下方，展示当前品种相关的最新新闻或公告。
 *
 * 富途风格的紧凑列表布局，支持多数据源降级：请求部分数据源降级时把失败源在底部作为 unavailable 提示。
 */
import { useEffect, useState } from 'react'
import { fetchNewsArticle } from './api.ts'
import type { MarketLocaleKey } from './contract.ts'
import { isAnnouncementSource } from './news-source.ts'
import css from './news-feed-pane.module.css'

export interface ClientNewsItem {
  source: string
  title: string
  url: string
  publishedAt: string
  /** 热度等级（可选；金十快讯网页版 火/热/沸/爆）。 */
  hot?: string
}

export interface NewsFeedPaneProps {
  /** 新闻条目列表 */
  items: readonly ClientNewsItem[] | null
  /** 失败的数据源 */
  unavailable?: readonly string[] | undefined
  /** 是否占满高度（用于 Tab 独立页签视图） */
  fullHeight?: boolean | undefined
  /** 过滤类型：仅公告（exchange）、仅媒体快讯（media）或全部资讯（all） */
  filterType?: 'exchange' | 'media' | 'all' | undefined
  /** 国际化翻译函数 */
  t: (key: MarketLocaleKey, params?: Record<string, unknown>) => string
}

/** 相对时间（locale 词典驱动：news.time.* 键，n 为数量占位）。 */
function relativeTime(isoString: string, t: (key: MarketLocaleKey, params?: Record<string, unknown>) => string): string {
  const time = new Date(isoString).getTime()
  if (Number.isNaN(time)) return ''
  const diff = Date.now() - time
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return t('news.time.justNow')
  if (minutes < 60) return t('news.time.minutesAgo', { n: String(minutes) })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('news.time.hoursAgo', { n: String(hours) })
  const days = Math.floor(hours / 24)
  if (days < 30) return t('news.time.daysAgo', { n: String(days) })
  const months = Math.floor(days / 30)
  if (months < 12) return t('news.time.monthsAgo', { n: String(months) })
  return t('news.time.yearsAgo', { n: String(Math.floor(months / 12)) })
}

function getSourceType(source: string): string {
  if (isAnnouncementSource(source)) return 'exchange'
  if (source.toLowerCase().includes('rss')) return 'rss'
  return 'media'
}

/** 数据源 → 显示名（词典键驱动；未收录的源 id 原样展示）。 */
const SOURCE_LABEL_KEY: Record<string, MarketLocaleKey> = {
  'eastmoney-announcement': 'news.source.eastmoneyAnnouncement',
  'eastmoney-fund-announcement': 'news.source.eastmoneyFundAnnouncement',
  'eastmoney': 'news.source.eastmoney',
  'eastmoney-symbol-news': 'news.source.eastmoneySymbolNews',
  'hkex-announcement': 'news.source.hkexAnnouncement',
  'cninfo-announcement': 'news.source.cninfoAnnouncement',
  'sec-edgar': 'news.source.secEdgar',
  'binance': 'news.source.binance',
  'okx': 'news.source.okx',
  'coindesk': 'news.source.coindesk',
  'theblock': 'news.source.theblock',
  'cointelegraph': 'news.source.cointelegraph',
  'decrypt': 'news.source.decrypt',
  'jin10': 'news.source.jin10',
}

function formatSourceLabel(source: string, t: (key: MarketLocaleKey, params?: Record<string, unknown>) => string): string {
  const key = SOURCE_LABEL_KEY[source]
  if (key !== undefined) return t(key)
  const lower = source.toLowerCase()
  if (lower.includes('yahoo')) return t('news.source.yahoo')
  if (lower.includes('google')) return t('news.source.google')
  return source
}

export function NewsFeedPane({ items, unavailable, fullHeight = false, filterType = 'all', t }: NewsFeedPaneProps): React.JSX.Element {
  const [, setNow] = useState(Date.now())
  const [openUrl, setOpenUrl] = useState<string | null>(null)
  const [article, setArticle] = useState<{ title: string; sourceHost: string; paragraphs: string[] } | null>(null)
  const [articleState, setArticleState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle')

  // 每分钟更新一次相对时间
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (openUrl === null) return
    let cancelled = false
    setArticle(null)
    setArticleState('loading')
    fetchNewsArticle(openUrl)
      .then((text) => {
        if (cancelled) return
        setArticle(text)
        setArticleState('ready')
      })
      .catch(() => {
        if (!cancelled) setArticleState('failed')
      })
    return () => { cancelled = true }
  }, [openUrl])

  const filteredItems = items === null ? null : (
    filterType === 'exchange'
      ? items.filter(it => getSourceType(it.source) === 'exchange')
      : filterType === 'media'
        ? items.filter(it => getSourceType(it.source) !== 'exchange')
        : items
  )

  const rootClass = `${css.pane} ${fullHeight ? css.fullHeight : ''}`

  if (filteredItems === null) {
    return (
      <div className={rootClass} data-dshtrading-news-feed="">
        <div className={css.empty}>{filterType === 'exchange' ? t('news.empty.exchangeNotReady') : t('news.empty.mediaNotActive')}</div>
      </div>
    )
  }

  if (filteredItems.length === 0) {
    return (
      <div className={rootClass} data-dshtrading-news-feed="">
        <div className={css.empty}>{filterType === 'exchange' ? t('news.empty.noAnnouncements') : t('news.empty.noNews')}</div>
      </div>
    )
  }

  const opened = filteredItems.find(item => item.url === openUrl)

  return (
    <div className={rootClass} data-dshtrading-news-feed="">
      <ul className={css.list}>
        {filteredItems.map((item, index) => (
          <li
            key={`${item.url}-${index}`}
            className={css.item}
            data-open={item.url === openUrl ? 'true' : undefined}
            onClick={() => { setOpenUrl(current => current === item.url ? null : item.url) }}
          >
            <span className={css.source} data-type={getSourceType(item.source)}>
              {formatSourceLabel(item.source, t)}
            </span>
            {item.hot !== undefined && item.hot !== '' && (
              <span className={css.hotBadge} data-hot={item.hot}>{item.hot}</span>
            )}
            <span className={css.title} title={item.title}>
              {item.title}
            </span>
            <span className={css.time}>
              {relativeTime(item.publishedAt, t)}
            </span>
          </li>
        ))}
      </ul>
      {opened !== undefined && (
        <article className={css.reader} data-news-reader="">
          <div className={css.readerBar}>
            <span className={css.readerHost}>{article?.sourceHost || formatSourceLabel(opened.source, t)}</span>
            <button type="button" className={css.readerClose} onClick={() => { setOpenUrl(null) }}>
              {t('news.reader.close')}
            </button>
          </div>
          <h3 className={css.readerTitle}>{article?.title || opened.title}</h3>
          {articleState === 'loading' && <p className={css.readerStatus}>{t('news.reader.loading')}</p>}
          {articleState === 'failed' && <p className={css.readerStatus}>{t('news.reader.failed')}</p>}
          {articleState === 'ready' && article !== null && article.paragraphs.length === 0 && (
            <p className={css.readerStatus}>{t('news.reader.empty')}</p>
          )}
          {article?.paragraphs.map((paragraph, index) => (
            <p key={index} className={css.readerText}>{paragraph}</p>
          ))}
        </article>
      )}
      {unavailable !== undefined && unavailable.length > 0 && (
        <div className={css.degraded}>
          {t('news.degraded', { sources: unavailable.join(', ') })}
        </div>
      )}
    </div>
  )
}
