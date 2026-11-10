import type { Ticker } from './types.ts'
import type { MarketLocaleKey } from './contract.ts'

type About = NonNullable<Ticker['about']>

const SECTOR_KEY: Record<string, MarketLocaleKey> = {
  SECTOR_IT: 'quote.sector.it',
  IT: 'quote.sector.it',
  SECTOR_ELECTRONICS: 'quote.sector.it',
  ELECTRONICS: 'quote.sector.it',
  SECTOR_ECOM: 'quote.sector.ecom',
  ECOM: 'quote.sector.ecom',
  SECTOR_TELECOM: 'quote.sector.telecom',
  TELECOM: 'quote.sector.telecom',
  SECTOR_FINANCIALS: 'quote.sector.finance',
  FINANCIALS: 'quote.sector.finance',
  SECTOR_FINANCIAL: 'quote.sector.finance',
  FINANCIAL: 'quote.sector.finance',
  SECTOR_ENERGY: 'quote.sector.energy',
  ENERGY: 'quote.sector.energy',
  SECTOR_GREEN_ENERGY: 'quote.sector.energy',
  GREEN_ENERGY: 'quote.sector.energy',
  SECTOR_MATERIALS: 'quote.sector.materials',
  MATERIALS: 'quote.sector.materials',
  SECTOR_INDUSTRIALS: 'quote.sector.industry',
  INDUSTRIALS: 'quote.sector.industry',
  SECTOR_CONSUMER: 'quote.sector.consumer',
  CONSUMER: 'quote.sector.consumer',
  SECTOR_HEALTHCARE: 'quote.sector.health',
  HEALTHCARE: 'quote.sector.health',
  SECTOR_UTILITIES: 'quote.sector.utilities',
  UTILITIES: 'quote.sector.utilities',
  SECTOR_REAL_ESTATE: 'quote.sector.realEstate',
  REAL_ESTATE: 'quote.sector.realEstate',
}

const FOCUS_KEY: Record<string, MarketLocaleKey> = {
  FOCUS_TYPE_EQUITY: 'quote.fund.equity',
  EQUITY: 'quote.fund.equity',
  FOCUS_TYPE_BOND: 'quote.fund.bond',
  BOND: 'quote.fund.bond',
  FOCUS_TYPE_MONEY: 'quote.fund.money',
  MONEY: 'quote.fund.money',
  FOCUS_TYPE_COMMODITY: 'quote.fund.commodity',
  COMMODITY: 'quote.fund.commodity',
  FOCUS_TYPE_MIXED: 'quote.fund.mixed',
  MIXED: 'quote.fund.mixed',
}

function enumKey(raw: string | undefined, table: Record<string, MarketLocaleKey>): MarketLocaleKey | undefined {
  if (raw === undefined || raw.trim() === '') return undefined
  const token = raw.trim().toUpperCase().replace(/^.*_UNSPECIFIED$/, '')
  return table[token]
}

/** ISO или protobuf-строка даты → ДД.ММ.ГГГГ. Неразборчивое значение не показываем. */
export function formatMaturity(raw: string): string | undefined {
  const match = raw.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return undefined
  return `${match[3]}.${match[2]}.${match[1]}`
}

/** Одна строка под названием: что это за бумага, без повтора тикера. */
export function quoteAboutLine(
  about: About | undefined,
  t: (key: MarketLocaleKey, params?: Record<string, unknown>) => string,
): string | undefined {
  if (about === undefined) return undefined
  const parts: string[] = []
  if (about.listing === 'bond') {
    parts.push(t(about.ofz === true ? 'quote.kind.ofz' : 'quote.kind.corpBond'))
    const maturity = about.maturity !== undefined ? formatMaturity(about.maturity) : undefined
    if (maturity !== undefined) parts.push(t('quote.bond.maturity', { date: maturity }))
    if (about.couponsPerYear !== undefined && about.couponsPerYear > 0) {
      parts.push(t('quote.bond.coupon', { n: String(about.couponsPerYear) }))
    }
  } else if (about.listing === 'fund') {
    parts.push(t('quote.kind.fund'))
    const focus = enumKey(about.focus, FOCUS_KEY)
    if (focus !== undefined) parts.push(t(focus))
  } else if (about.listing === 'share') {
    const sector = enumKey(about.sector, SECTOR_KEY)
    parts.push(sector !== undefined ? t('quote.share.sector', { sector: t(sector) }) : t('quote.kind.share'))
  }
  const line = parts.filter(part => part.trim() !== '').join(', ')
  return line === '' ? undefined : line
}
