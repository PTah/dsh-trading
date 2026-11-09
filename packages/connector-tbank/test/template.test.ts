/**
 * T-Bank 连接器结构冒烟：Config 默认值、凭证 ref 分组、闸门三态、互斥激活。
 */
import { installTestAuthority, type TestAuthority } from '@dshtrading/authority/testing'
import { Context as CordisContext } from '@deepseek-ai/cordis'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  apply,
  credentialRefsFor,
  evaluateOrderGate,
  resolveCredentials,
  Config,
  type Config as ConfigType,
} from '../src/index.js'

let testAuthority: TestAuthority | undefined
beforeAll(() => { testAuthority = installTestAuthority() })
afterAll(() => { testAuthority?.uninstall() })

const DEFAULTS: ConfigType = {
  enabled: false,
  env: 'demo',
  dryRun: true,
  liveTrading: false,
  tokenRef: 'TBANK_TOKEN',
  demoTokenRef: 'TBANK_DEMO_TOKEN',
  accountId: '',
}

describe('connector-tbank 结构面', () => {
  it('Config schema 默认面 = enabled=false / dryRun=true / liveTrading=false', () => {
    // Given / When
    const resolved = (Config as unknown as (v: unknown) => ConfigType)({})
    // Then
    expect(resolved.enabled).toBe(false)
    expect(resolved.dryRun).toBe(true)
    expect(resolved.liveTrading).toBe(false)
    expect(resolved.env).toBe('demo')
    expect(resolved.tokenRef).toBe('TBANK_TOKEN')
    expect(resolved.demoTokenRef).toBe('TBANK_DEMO_TOKEN')
  })

  it('凭证 ref：live 用 TBANK_TOKEN，demo 用 TBANK_DEMO_TOKEN', () => {
    // Given / When / Then
    expect(credentialRefsFor(DEFAULTS, 'live').tokenRef).toBe('TBANK_TOKEN')
    expect(credentialRefsFor(DEFAULTS, 'demo').tokenRef).toBe('TBANK_DEMO_TOKEN')
  })

  it('resolveCredentials：无 seam 时回落 process.env；有 seam 且空值 fail-closed', async () => {
    // Given: ambient env
    const prev = process.env.TBANK_DEMO_TOKEN
    process.env.TBANK_DEMO_TOKEN = 'sandbox-token'
    try {
      const ambient = await resolveCredentials({ get: () => undefined }, credentialRefsFor(DEFAULTS, 'demo'), 'demo')
      expect(ambient).toEqual({ token: 'sandbox-token' })
    } finally {
      if (prev === undefined) delete process.env.TBANK_DEMO_TOKEN
      else process.env.TBANK_DEMO_TOKEN = prev
    }

    // Given: seam present but empty
    await expect(
      resolveCredentials(
        { get: () => ({ resolve: async () => undefined }) },
        credentialRefsFor(DEFAULTS, 'demo'),
        'demo',
      ),
    ).rejects.toMatchObject({ code: 'TRADING_AUTH_FAILED' })
  })

  it('闸门三态：simulate / reject / live', () => {
    // Given
    const args = { symbol: 'SBER', side: 'BUY' as const, type: 'MARKET' as const, quantity: 10 }
    // When / Then
    expect(evaluateOrderGate(DEFAULTS, args).action).toBe('simulate')
    expect(evaluateOrderGate(DEFAULTS, { ...args, dryRun: false }).action).toBe('reject')
    const live: ConfigType = { ...DEFAULTS, liveTrading: true, dryRun: false }
    expect(evaluateOrderGate(live, { ...args, dryRun: false }).action).toBe('live')
    const forced: ConfigType = { ...DEFAULTS, liveTrading: true, dryRun: true }
    expect(evaluateOrderGate(forced, { ...args, dryRun: false }).action).toBe('simulate')
  })

  it('enabled=false 时 apply 不注册工具', () => {
    // Given
    const register = vi.fn()
    const ctx = {
      tools: { register },
      get: () => undefined,
      reflect: { provide: () => {} },
    } as unknown as CordisContext
    // When
    apply(ctx, DEFAULTS)
    // Then
    expect(register).not.toHaveBeenCalled()
  })
})
