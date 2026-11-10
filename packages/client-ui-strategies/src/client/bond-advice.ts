import type { InvestorAction } from './investor-advice.ts'

export type BondPriceZone = 'discount' | 'near' | 'premium'

export interface BondQuote {
  nominal: number
  aci: number
  pricePercent: number
  clean: number
  dirty: number
}

/**
 * Цена к номиналу меняет совет по покупке.
 * Ниже номинала держание становится осторожной покупкой: к погашению разница может добавиться.
 * Выше номинала покупка смягчается до держания: надбавка к погашению сгорает.
 * НКД на действие не влияет — его показывают отдельно как доплату в день покупки.
 */
export function adjustBondAdvice(action: InvestorAction, quote: Pick<BondQuote, 'pricePercent'>): {
  action: InvestorAction
  zone: BondPriceZone
} {
  const zone: BondPriceZone = quote.pricePercent < 98 ? 'discount' : quote.pricePercent > 102 ? 'premium' : 'near'
  if (zone === 'premium' && action === 'buy') return { action: 'hold', zone }
  if (zone === 'discount' && action === 'hold') return { action: 'buy', zone }
  return { action, zone }
}

/** НКД больше 1.5% номинала — чек заметно выше чистой цены. */
export function bondAciIsMaterial(quote: Pick<BondQuote, 'nominal' | 'aci'>): boolean {
  return quote.nominal > 0 && quote.aci / quote.nominal >= 0.015
}
