/**
 * Рынок прогнозов снят с правой колонки, пока нет российского контура.
 * Панель Polymarket остаётся в коде и покрыта своим smoke-тестом.
 *
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { MarketLocaleKey } from '../src/client/contract.ts'
import { SessionRail } from '../src/client/SessionRail.tsx'

const t = (key: MarketLocaleKey): string => key

describe('SessionRail without a prediction tab', () => {
  afterEach(() => cleanup())

  it('Agent: does not offer the prediction-market button', () => {
    render(
      <SessionRail
        t={t}
        useFolded={<T,>(sel: (value: boolean) => T): T => sel(false)}
        useRightbar={<T,>(sel: (value: boolean) => T): T => sel(false)}
        startNewSession={() => {}}
        toggleFold={() => {}}
        openSession={() => {}}
        openFilesPanel={() => {}}
        collapseRightbar={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: 'stage.prediction' })).toBeNull()
    expect(screen.getByRole('button', { name: 'stage.flash' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'stage.macro' })).toBeTruthy()
  })
})
