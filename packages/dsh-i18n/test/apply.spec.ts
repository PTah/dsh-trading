import { describe, expect, it, vi } from 'vitest'
import { apply, LANGUAGES, LOCALE_PACKAGES, PACKAGES, RU_PACKAGES } from '../src/client/index.ts'

/** Total register calls across every extra locale pack. */
const REGISTER_COUNT = LOCALE_PACKAGES.reduce((sum, entry) => sum + entry.packages.length, 0)

/** mock 宿主 locale 服务面（addLanguage/register/dispose 语义）。 */
function createLocaleMock() {
  const calls: Array<{ kind: string; args: unknown[] }> = []
  const disposers = vi.fn()
  return {
    calls,
    disposers,
    addLanguage: (input: unknown) => {
      calls.push({ kind: 'addLanguage', args: [input] })
      return disposers
    },
    register: (ns: string, locale: string, dict: Record<string, string>) => {
      calls.push({ kind: 'register', args: [ns, locale, dict] })
      return disposers
    },
  }
}

function createCtxMock(locale: ReturnType<typeof createLocaleMock> | null) {
  let cleanup: (() => void) | undefined
  return {
    effect: (execute: () => unknown, label: string) => {
      void label
      cleanup = execute() as (() => void) | undefined
    },
    locale,
    /** 触发 effect 的清理函数（宿主在插件停止/重载时调用）。 */
    runCleanup: (): void => { cleanup?.(); cleanup = undefined },
  } as never
}

describe('dsh-i18n apply semantics', () => {
  it('registers every package namespace under each LOCALE_PACKAGES locale plus each declared language', () => {
    const locale = createLocaleMock()
    apply(createCtxMock(locale))
    const registers = locale.calls.filter(c => c.kind === 'register')
    const addLanguages = locale.calls.filter(c => c.kind === 'addLanguage')
    expect(addLanguages).toHaveLength(LANGUAGES.length)
    expect(registers).toHaveLength(REGISTER_COUNT)
    const expected = LOCALE_PACKAGES.flatMap(({ locale: id, packages }) =>
      packages.map(([ns, dict]) => [ns, id, dict] as const),
    )
    for (let i = 0; i < expected.length; i++) {
      expect(registers[i].args[0]).toBe(expected[i][0])
      expect(registers[i].args[1]).toBe(expected[i][1])
      expect(registers[i].args[2]).toBe(expected[i][2])
      expect(Object.keys(registers[i].args[2] as Record<string, string>).length).toBeGreaterThan(0)
    }
  })

  it('survives addLanguage rejection and still registers dictionaries', () => {
    const calls: Array<{ kind: string; args: unknown[] }> = []
    const locale = {
      addLanguage: () => { throw new Error('id occupied') },
      register: (ns: string, l: string, dict: Record<string, string>) => {
        calls.push({ kind: 'register', args: [ns, l, dict] })
        return () => {}
      },
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    apply(createCtxMock(locale as never))
    warn.mockRestore()
    expect(calls).toHaveLength(REGISTER_COUNT)
  })

  it('survives register rejection (namespace occupied) and keeps later namespaces', () => {
    const calls: Array<{ kind: string; args: unknown[] }> = []
    const failed = PACKAGES[1][0]
    const locale = {
      addLanguage: () => () => {},
      register: (ns: string, l: string, dict: Record<string, string>) => {
        if (ns === failed && l === 'zh-CN') throw new Error('ns occupied')
        calls.push({ kind: 'register', args: [ns, l, dict] })
        return () => {}
      },
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    apply(createCtxMock(locale as never))
    warn.mockRestore()
    // 失败的 (ns, zh-CN) 只跳过自己；同 ns 的 ru 与其余 ns 照常注册
    expect(calls).toHaveLength(REGISTER_COUNT - 1)
    expect(calls.some(c => c.args[0] === failed && c.args[1] === 'zh-CN')).toBe(false)
    expect(calls.some(c => c.args[0] === failed && c.args[1] === 'ru')).toBe(true)
  })

  it('cleanup disposes in reverse registration order exactly once (double-invoke safe)', () => {
    const order: string[] = []
    let counter = 0
    const locale = {
      addLanguage: () => { const id = `lang${++counter}`; return () => order.push(id) },
      register: (ns: string, l: string) => { const id = `reg:${ns}:${l}`; return () => order.push(id) },
    }
    const ctx = createCtxMock(locale as never)
    apply(ctx)
    const expectedCount = LANGUAGES.length + REGISTER_COUNT
    expect(order).toHaveLength(0)
    // @ts-expect-error 测试 mock 扩展面
    ctx.runCleanup()
    expect(order).toHaveLength(expectedCount)
    // 逆序：后注册的先清理（register 全部在 addLanguage 之后 push）
    const lastPkg = LOCALE_PACKAGES[LOCALE_PACKAGES.length - 1]!
    const lastNs = lastPkg.packages[lastPkg.packages.length - 1]![0]
    expect(order[0]).toBe(`reg:${lastNs}:${lastPkg.locale}`)
    expect(order[order.length - 1]).toBe('lang1')
    // disposed 守卫：二次调用为 no-op
    // @ts-expect-error 测试 mock 扩展面
    ctx.runCleanup()
    expect(order).toHaveLength(expectedCount)
  })

  it('failed registrations leave no disposer (cleanup never throws on undefined)', () => {
    const order: string[] = []
    const locale = {
      addLanguage: () => { throw new Error('occupied') },
      register: (ns: string, l: string) => {
        if (ns === PACKAGES[0][0] && l === 'zh-CN') throw new Error('occupied')
        return () => order.push(`${ns}:${l}`)
      },
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ctx = createCtxMock(locale as never)
    apply(ctx)
    warn.mockRestore()
    // @ts-expect-error 测试 mock 扩展面
    ctx.runCleanup()
    const expected = LOCALE_PACKAGES
      .flatMap(({ locale: id, packages }) => packages.map(([ns]) => `${ns}:${id}`))
      .filter(id => id !== `${PACKAGES[0][0]}:zh-CN`)
      .reverse()
    expect(order).toEqual(expected)
  })

  it('register receives the exact dict identity from LOCALE_PACKAGES (no stale copy)', () => {
    const locale = createLocaleMock()
    apply(createCtxMock(locale))
    const registers = locale.calls.filter(c => c.kind === 'register')
    const expected = LOCALE_PACKAGES.flatMap(({ locale: id, packages }) =>
      packages.map(([ns, dict]) => [ns, id, dict] as const),
    )
    expected.forEach(([ns, id, dict], i) => {
      expect(registers[i].args[0]).toBe(ns)
      expect(registers[i].args[1]).toBe(id)
      expect(registers[i].args[2]).toBe(dict)
    })
  })
})

describe('dsh-i18n dictionaries', () => {
  it('carries non-empty zh dictionaries for every namespace', () => {
    for (const [ns, dict] of PACKAGES) {
      expect(ns.startsWith('dshtrading.')).toBe(true)
      const keys = Object.keys(dict)
      expect(keys.length).toBeGreaterThan(0)
      for (const key of keys) {
        expect(typeof dict[key]).toBe('string')
      }
    }
  })

  it('ru dictionaries cover the same keys as zh packages', () => {
    expect(RU_PACKAGES.map(([ns]) => ns)).toEqual(PACKAGES.map(([ns]) => ns))
    for (let i = 0; i < PACKAGES.length; i++) {
      const zhKeys = Object.keys(PACKAGES[i][1]).sort()
      const ruKeys = Object.keys(RU_PACKAGES[i][1]).sort()
      expect(ruKeys).toEqual(zhKeys)
    }
  })

  it('values carry balanced {placeholder} braces', () => {
    for (const { packages } of LOCALE_PACKAGES) {
      for (const [, dict] of packages) {
        for (const value of Object.values(dict)) {
          const open = (value.match(/\{/g) ?? []).length
          const close = (value.match(/\}/g) ?? []).length
          expect(open).toBe(close)
        }
      }
    }
  })
})
