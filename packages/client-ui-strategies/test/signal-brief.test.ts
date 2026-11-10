import { describe, expect, it } from 'vitest'
import { stanceOf } from '../src/client/signal-brief.ts'
import type { StrategySignal } from '@dshtrading/strategies'

function signal(action: 'entry' | 'exit'): StrategySignal {
  return { index: 0, time: 0, action, direction: action === 'entry' ? 'long' : 'flat', price: 1, reason: '' }
}

describe('stanceOf', () => {
  it('Agent: keeps the latest entry or exit as the current stance', () => {
    // Given a rule that entered and later exited
    // When the brief reads the signal list
    // Then the stance follows the last action
    expect(stanceOf([])).toBe('flat')
    expect(stanceOf([signal('entry')])).toBe('long')
    expect(stanceOf([signal('entry'), signal('exit')])).toBe('flat')
  })
})
