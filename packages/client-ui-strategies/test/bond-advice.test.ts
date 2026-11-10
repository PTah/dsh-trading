import { describe, expect, it } from 'vitest'
import { adjustBondAdvice, bondAciIsMaterial } from '../src/client/bond-advice.ts'

describe('adjustBondAdvice', () => {
  it('Agent: a price below par turns hold into a small buy, a price above par turns buy into hold', () => {
    // Given a bond quoted under and over the 1000 face
    // When the chart rules say hold or buy
    // Then the face-value gap changes the action, and NKD does not
    expect(adjustBondAdvice('hold', { pricePercent: 96.5 })).toEqual({ action: 'buy', zone: 'discount' })
    expect(adjustBondAdvice('buy', { pricePercent: 104 })).toEqual({ action: 'hold', zone: 'premium' })
    expect(adjustBondAdvice('buy', { pricePercent: 100.2 })).toEqual({ action: 'buy', zone: 'near' })
    expect(adjustBondAdvice('watch', { pricePercent: 95 })).toEqual({ action: 'watch', zone: 'discount' })
    expect(bondAciIsMaterial({ nominal: 1000, aci: 20 })).toBe(true)
    expect(bondAciIsMaterial({ nominal: 1000, aci: 4 })).toBe(false)
  })
})
