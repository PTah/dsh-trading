/**
 * Клик по новости читает текст внутри вкладки и не открывает внешнее окно.
 *
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MarketLocaleKey } from '../src/client/contract.ts'

vi.mock('../src/client/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/client/api.ts')>()
  return {
    ...actual,
    fetchNewsArticle: async () => ({
      title: 'Рынок открылся ростом',
      sourceHost: 'finmarket.ru',
      paragraphs: ['Индекс Мосбиржи вырос, и этот текст остаётся внутри терминала.'],
    }),
  }
})

import { NewsFeedPane } from '../src/client/NewsFeedPane.tsx'

const t = (key: MarketLocaleKey): string => key

describe('in-app news reader', () => {
  afterEach(() => cleanup())

  it('Agent: opens the article text in the news tab', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(
      <NewsFeedPane
        fullHeight
        t={t}
        items={[{
          source: 'Finmarket.ru',
          title: 'Рынок акций РФ',
          url: 'https://news.google.com/rss/articles/abc',
          publishedAt: '2026-11-10T00:00:00.000Z',
        }]}
      />,
    )
    fireEvent.click(screen.getByText('Рынок акций РФ'))
    expect(await screen.findByText('Индекс Мосбиржи вырос, и этот текст остаётся внутри терминала.')).toBeTruthy()
    expect(screen.getByText('finmarket.ru')).toBeTruthy()
    expect(open).not.toHaveBeenCalled()
    open.mockRestore()
  })
})
