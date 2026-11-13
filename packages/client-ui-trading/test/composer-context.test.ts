/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import {
  composerContextLine,
  installComposerSelectionContext,
  shouldAttachComposerContext,
} from '../src/client/composer-context.ts'

const ozon = { market: 'ru', symbol: 'OZON', name: 'Озон' }

describe('composer selection context', () => {
  it('Agent: names the selected share and ticker on one line', () => {
    expect(composerContextLine(ozon)).toBe('[Бумага OZON] Озон (OZON), Россия, рынок ru\n')
    expect(composerContextLine({ market: 'ru', symbol: 'SU29007RMFS0', name: 'SU29007RMFS0' }))
      .toBe('[Бумага SU29007RMFS0] SU29007RMFS0, Россия, рынок ru\n')
  })

  it('Agent: skips an empty draft, a slash command, and a draft that already names the ticker', () => {
    const line = composerContextLine(ozon)
    expect(shouldAttachComposerContext('', line)).toBe(false)
    expect(shouldAttachComposerContext('   ', line)).toBe(false)
    expect(shouldAttachComposerContext('/help', line)).toBe(false)
    expect(shouldAttachComposerContext('что с ней?', line)).toBe(true)
    expect(shouldAttachComposerContext(`${line}что с ней?`, line)).toBe(false)
  })

  it('Agent: prepends the selected paper when Enter is pressed in the composer', () => {
    const inserted: string[] = []
    const root = document.createElement('div')
    root.setAttribute('contenteditable', 'true')
    root.setAttribute('data-composer-input', 'true')
    root.textContent = 'что с ней?'
    root.addEventListener('beforeinput', (event) => {
      const input = event as InputEvent
      inserted.push(input.data ?? '')
      event.preventDefault()
    })
    document.body.append(root)
    const stop = installComposerSelectionContext(() => ozon)
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }))
    stop()
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(inserted).toEqual(['[Бумага OZON] Озон (OZON), Россия, рынок ru\n'])
    root.remove()
  })

  it('Agent: does not prepend when no paper is selected', () => {
    const inserted: string[] = []
    const root = document.createElement('div')
    root.setAttribute('contenteditable', 'true')
    root.setAttribute('data-composer-input', 'true')
    root.textContent = 'что с ней?'
    root.addEventListener('beforeinput', (event) => {
      inserted.push('hit')
      event.preventDefault()
    })
    document.body.append(root)
    const stop = installComposerSelectionContext(() => null)
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    stop()
    expect(inserted).toEqual([])
    root.remove()
  })

  it('Agent: prepends when the send arrow is clicked, not the stop button', () => {
    const inserted: string[] = []
    const card = document.createElement('div')
    card.setAttribute('data-composer-card', 'true')
    const root = document.createElement('div')
    root.setAttribute('contenteditable', 'true')
    root.setAttribute('data-composer-input', 'true')
    root.textContent = 'что с ней?'
    root.addEventListener('beforeinput', (event) => {
      inserted.push((event as InputEvent).data ?? '')
      event.preventDefault()
    })
    const send = document.createElement('button')
    send.innerHTML = '<svg><path d="M8.3125 0.980183C8 1 9 2"></path></svg>'
    const stopBtn = document.createElement('button')
    stopBtn.innerHTML = '<svg><rect width="10" height="10"></rect></svg>'
    card.append(root, send, stopBtn)
    document.body.append(card)
    const exec = vi.fn(() => true)
    document.execCommand = exec
    const stop = installComposerSelectionContext(() => ozon)
    stopBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    send.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    stop()
    expect(inserted).toEqual(['[Бумага OZON] Озон (OZON), Россия, рынок ru\n'])
    expect(exec).not.toHaveBeenCalled()
    exec.mockRestore()
    card.remove()
  })
})
