/**
 * dsh-i18n browser half: central language pack.
 *
 * 注册「简体中文」（zh-CN）进宿主 Settings → General → Language 语言目录
 * （宿主内置 zh=中文 / en=English，zh-CN fallback zh），并为全部 dshtrading
 * 命名空间注册 zh-CN 与 ru 词典（untyped 单语言 overload——zh/en 由源包 typed
 * register 持有，(ns, locale) 单一占主语义允许语言包补额外语言）。
 *
 * 宿主 0.2.x 已内置 ru（fallback en）；本包只补 dshtrading.* 的 ru 词典，
 * 不再 addLanguage('ru')，避免与宿主目录项冲突。
 *
 * 词典来源：
 * - zh-CN：构建期 import 各源包 locales.ts 的 zh——恒等于 zh，零漂移；
 * - ru：本包 src/client/ru/* 手持俄语词典（额外语言家在本包）。
 *
 * 新增语言范式：import 词典模块 → LOCALE_PACKAGES 加一组映射；若语言目录
 * 尚无该项再进 LANGUAGES。注册失败逐项 try/catch。
 */
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { zh as marketZh } from '@dshtrading/client-ui-trading/locales'
import { zh as settingsZh } from '@dshtrading/client-ui-settings/locales'
import { zh as strategiesZh } from '@dshtrading/client-ui-strategies/locales'
import { zh as knowledgeZh } from '@dshtrading/client-ui-knowledge/locales'
import { zh as updaterZh } from '@dshtrading/client-ui-updater/locales'
import {
  knowledgeRu,
  marketRu,
  settingsRu,
  strategiesRu,
  updaterRu,
} from './ru/index.ts'

/** Required services：宿主 locale 服务（语言目录 + 词典注册表）。 */
export const inject = ['locale']

/** 命名空间 → zh 词典映射（audit 依此核对 zh-CN 覆盖面）。 */
export const PACKAGES: ReadonlyArray<readonly [ns: string, dict: Record<string, string>]> = [
  ['dshtrading.market', marketZh],
  ['dshtrading.settings', settingsZh],
  ['dshtrading.strategies', strategiesZh],
  ['dshtrading.knowledge', knowledgeZh],
  ['dshtrading.updater', updaterZh],
]

/** 命名空间 → ru 词典映射（本包持有；键位与对应源包 en/zh 对齐）。 */
export const RU_PACKAGES: ReadonlyArray<readonly [ns: string, dict: Record<string, string>]> = [
  ['dshtrading.market', marketRu],
  ['dshtrading.settings', settingsRu],
  ['dshtrading.strategies', strategiesRu],
  ['dshtrading.knowledge', knowledgeRu],
  ['dshtrading.updater', updaterRu],
]

/** 额外语言 → 各命名空间词典（register 循环的单一入口）。 */
export const LOCALE_PACKAGES: ReadonlyArray<{
  locale: string
  packages: ReadonlyArray<readonly [ns: string, dict: Record<string, string>]>
}> = [
  { locale: 'zh-CN', packages: PACKAGES },
  { locale: 'ru', packages: RU_PACKAGES },
]

/** 语言目录注册项（id 持久化为 locale preference；label 用该语言自述）。
 *  ru 已由宿主 dsh-client-locale 注册，不在此重复 addLanguage。 */
export const LANGUAGES: ReadonlyArray<{ id: string; label: string; fallback: string }> = [
  { id: 'zh-CN', label: '简体中文', fallback: 'zh' }, // i18n-allow: 语言自述名按目标语言书写（SDK 契约）
]

/** 注册语言目录 + 全部命名空间的额外语言词典（幂等：可重复 apply）。 */
export function apply(ctx: ClientContext): void {
  const disposers: Array<() => void> = []
  let disposed = false

  ctx.effect(() => {
    for (const language of LANGUAGES) {
      try {
        disposers.push(ctx.locale.addLanguage(language))
      } catch (error) {
        // 语言目录项被占主（重复安装/宿主已含）→ 静默降级：词典仍注册，
        // 语言行维持宿主侧状态。
        console.warn(`[dsh-i18n] addLanguage(${language.id}) skipped:`, error)
      }
    }
    for (const { locale, packages } of LOCALE_PACKAGES) {
      for (const [ns, dict] of packages) {
        try {
          disposers.push(ctx.locale.register(ns, locale, dict))
        } catch (error) {
          console.warn(`[dsh-i18n] register(${ns}, ${locale}) skipped:`, error)
        }
      }
    }
    return () => {
      if (disposed) return
      disposed = true
      for (const dispose of disposers.reverse()) dispose()
    }
  }, 'dsh-i18n: language packs')
}
