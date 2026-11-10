/**
 * FlashPanel берёт русские заголовки через /news?market=ru, без китайских меток важности.
 *
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MarketLocaleKey } from '../src/client/contract.ts'

const net = vi.hoisted(() => ({
  calls: [] as Array<{ market?: string; symbol?: string }>,
}))

vi.mock('../src/client/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/client/api.ts')>()
  return {
    ...actual,
    fetchNews: async (market: string, symbol?: string) => {
      net.calls.push({ market, ...(symbol !== undefined ? { symbol } : {}) })
      return {
        items: [{ source: 'РБК', title: 'Сбербанк', url: 'https://example.test/sber', publishedAt: '2026-11-08T10:00:00.000Z' }],
        unavailable: [],
      }
    },
  }
})

import { FlashPanel } from '../src/client/FlashPanel.tsx'

const t = (key: MarketLocaleKey): string => key

describe('FlashPanel russian headlines', () => {
  beforeEach(() => { net.calls.length = 0 })
  afterEach(() => cleanup())

  it('Agent: loads the Russia news feed and does not show Jin10 heat chips', async () => {
    render(<FlashPanel t={t} onClose={() => {}} />)
    await waitFor(() => { expect(net.calls[0]?.market).toBe('ru') })
    expect(net.calls[0]?.symbol).toBeUndefined()
    expect(screen.queryByRole('button', { name: '沸' })).toBeNull()
    expect(screen.getByText('flash.ruHint')).toBeTruthy()
    expect(screen.getByText('Сбербанк')).toBeTruthy()
  })
})
