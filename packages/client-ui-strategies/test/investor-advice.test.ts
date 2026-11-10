import { describe, expect, it } from 'vitest'
import { advise, type StanceRow } from '../src/client/investor-advice.ts'

function row(horizon: StanceRow['horizon'], stance: StanceRow['stance']): StanceRow {
  return { horizon, stance }
}

describe('advise', () => {
  it('Agent: turns rule stances into one plain action', () => {
    // Given no rows
    // When the brief asks for an action
    // Then it waits
    expect(advise([])).toBe('watch')

    // Given most rules long, including the long horizon
    // When the votes are counted
    // Then the action is a small buy
    expect(advise([
      row('short', 'long'),
      row('swing', 'long'),
      row('long', 'long'),
    ])).toBe('buy')

    // Given half the rules long and the long horizon still long
    // When the votes are counted
    // Then the action is hold
    expect(advise([
      row('short', 'long'),
      row('swing', 'flat'),
      row('short', 'flat'),
      row('long', 'long'),
    ])).toBe('hold')

    // Given a weak long horizon and almost no longs
    // When the votes are counted
    // Then the action is reduce
    expect(advise([
      row('short', 'flat'),
      row('swing', 'flat'),
      row('long', 'flat'),
    ])).toBe('reduce')

    // Given a split that is neither a majority nor a clear exit
    // When the votes are counted
    // Then the action is wait
    expect(advise([
      row('short', 'long'),
      row('swing', 'flat'),
      row('swing', 'flat'),
      row('short', 'flat'),
      row('long', 'long'),
    ])).toBe('watch')
  })
})
