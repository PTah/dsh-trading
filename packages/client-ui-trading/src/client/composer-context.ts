/**
 * 把当前选中的标的写进宿主 composer 的草稿，再交给宿主自己的发送。
 * 宿主输入框是只读包里的 Lexical；这里只在捕获阶段把一行上下文插到光标起点。
 */

export interface ComposerSubject {
  market: string
  symbol: string
  name?: string
}

const MARKET_LABEL: Record<string, string> = {
  ru: 'Россия',
  us: 'США',
  cn: 'Китай',
  hk: 'Гонконг',
  crypto: 'крипто',
  futures: 'фьючерсы',
  global: 'мир',
}

/** 发送按钮箭头 path 的开头。停止按钮画的是方块，不走这条。 */
const SEND_ICON_PREFIX = 'M8.3125 0.980183'

/** 一行上下文。名称和代码相同（或没有名称）时只留代码。 */
export function composerContextLine(subject: ComposerSubject): string {
  const symbol = subject.symbol.trim()
  const name = subject.name?.trim() ?? ''
  const distinct = name !== '' && name.localeCompare(symbol, undefined, { sensitivity: 'accent' }) !== 0
  const who = distinct ? `${name} (${symbol})` : symbol
  const label = MARKET_LABEL[subject.market]
  const market = label !== undefined ? `${label}, рынок ${subject.market}` : `рынок ${subject.market}`
  return `[Бумага ${symbol}] ${who}, ${market}\n`
}

/** 空草稿、斜杠命令、以及已经带过同一代码标记的草稿不再插。 */
export function shouldAttachComposerContext(draft: string, line: string): boolean {
  const trimmed = draft.replace(/\u00a0/g, ' ').trim()
  if (trimmed === '' || trimmed.startsWith('/')) return false
  const symbol = line.match(/^\[Бумага ([^\]]+)\]/)?.[1]
  if (symbol === undefined) return false
  return !trimmed.includes(`[Бумага ${symbol}]`)
}

export function readComposerDraft(root: HTMLElement): string {
  const visible = root.innerText
  const raw = visible !== undefined && visible !== '' ? visible : (root.textContent ?? '')
  return raw.replace(/\u00a0/g, ' ')
}

function firstText(node: Node): Text | null {
  if (node.nodeType === Node.TEXT_NODE && node.textContent !== '') return node as Text
  for (const child of node.childNodes) {
    const found = firstText(child)
    if (found !== null) return found
  }
  return null
}

/** 把一行插到编辑器开头。Lexical 吃 beforeinput；没人接时退回 insertText。 */
export function insertComposerPrefix(root: HTMLElement, text: string): void {
  const doc = root.ownerDocument
  const view = doc.defaultView
  if (view === null) return
  root.focus()
  const selection = doc.getSelection()
  if (selection !== null) {
    const range = doc.createRange()
    const node = firstText(root)
    if (node !== null) range.setStart(node, 0)
    else range.setStart(root, 0)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
  }
  doc.dispatchEvent(new view.Event('selectionchange'))
  let consumed = false
  if (typeof view.InputEvent === 'function') {
    const input = new view.InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: text,
    })
    consumed = !root.dispatchEvent(input) || input.defaultPrevented
  }
  if (!consumed && typeof doc.execCommand === 'function') doc.execCommand('insertText', false, text)
}

function stamp(root: HTMLElement, subject: ComposerSubject | null): void {
  if (subject === null || subject.symbol.trim() === '') return
  if (root.getAttribute('contenteditable') !== 'true') return
  const line = composerContextLine(subject)
  if (!shouldAttachComposerContext(readComposerDraft(root), line)) return
  insertComposerPrefix(root, line)
}

function composerRootFrom(target: Element): HTMLElement | null {
  const card = target.closest('[data-composer-card]')
  const root = card?.querySelector('[data-composer-input]')
  return root instanceof HTMLElement ? root : null
}

/**
 * 在宿主提交之前（捕获阶段）给当前选中标的加一行。
 * 回车（不含 Shift/Ctrl）和发送箭头都会走到这里；停止按钮不会。
 */
export function installComposerSelectionContext(read: () => ComposerSubject | null): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return
    if (!(event.target instanceof Element)) return
    const direct = event.target.closest('[data-composer-input]')
    const root = direct instanceof HTMLElement ? direct : composerRootFrom(event.target)
    if (root === null) return
    stamp(root, read())
  }
  const onClick = (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) return
    const button = event.target.closest('button')
    if (!(button instanceof HTMLElement)) return
    if (!button.closest('[data-composer-card]')) return
    const icon = button.querySelector('path')?.getAttribute('d') ?? ''
    if (!icon.startsWith(SEND_ICON_PREFIX)) return
    const root = composerRootFrom(button)
    if (root === null) return
    stamp(root, read())
  }
  document.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('click', onClick, true)
  return () => {
    document.removeEventListener('keydown', onKeyDown, true)
    document.removeEventListener('click', onClick, true)
  }
}
