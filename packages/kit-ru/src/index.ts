/**
 * 俄股工具箱插件（dsh-trading ru 切片，T-Bank Invest 接入）。
 *
 * 能力面：skill provider —— ru-risk-checklist（T+1 结算/整手/卢布计价/休市跳空/
 * IIS 账户/sandbox 与 live token 风控）。加与其他市场 kit 同款的共享技能目录
 * （indicator-authoring / trading-strategy-paradigms / knowledge-curation /
 * trading-notes-setup）：base 的 role-skill 白名单按
 * `[<market>-risk-checklist, 共享技能…]` 生成，kit 少提供一项即 apply 期 fail-fast。
 * 行情与交易数据由 @dshtrading/connector-tbank 提供（tradingRuMarketData /
 * tradingRuTrade），本插件不重复 provide。
 *
 * @module @dshtrading/kit-ru
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import {
  BUNDLED_SKILL_RANK,
  type SkillCandidate,
  type SkillDefinition,
  type SkillProvider,
} from '@deepseek-ai/dsh-skill'
import {
  kitConfigSchema,
  kitSkillMessages,
  registerSkillProvider,
  skillWhitelistView,
  type KitConfig,
} from '@dshtrading/base/role-skills'

const PROVIDER_NAME = 'dsh-trading-ru'

/** SDK 的 SkillCandidate.locator 声明为 unknown；本包候选固定为随包分发的 file URL。 */
type BundledSkillCandidate = SkillCandidate & { locator: URL }

const SKILL_BODY_URL = new URL('../assets/skills/ru-risk-checklist.md', import.meta.url)
const AUTHORING_BODY_URL = new URL('../assets/skills/indicator-authoring.md', import.meta.url)
const STRATEGY_BODY_URL = new URL('../assets/skills/trading-strategy-paradigms.md', import.meta.url)
const KNOWLEDGE_CURATION_BODY_URL = new URL('../assets/skills/knowledge-curation.md', import.meta.url)
const JOURNAL_BODY_URL = new URL('../assets/skills/trading-notes-setup.md', import.meta.url)
const RESOURCE_BASE = {
  kind: 'directory',
  path: fileURLToPath(new URL('../assets/skills/', import.meta.url)),
} as const

const RISK_CHECKLIST_CANDIDATE: BundledSkillCandidate = {
  name: 'ru-risk-checklist',
  description: '俄股（MOEX）交易风控检查清单：开仓前逐项核对 T+1 结算、整手（lot）、卢布（RUB）计价与汇率、休市与节假日跳空、IIS 账户规则、sandbox 与 live token 区分。',
  invocation: { modelInvocable: true, userInvocable: true },
  provider: PROVIDER_NAME,
  source: 'bundled',
  resourceBase: RESOURCE_BASE,
  rank: BUNDLED_SKILL_RANK,
  locator: SKILL_BODY_URL,
}

const AUTHORING_CANDIDATE: BundledSkillCandidate = {
  name: 'indicator-authoring',
  description: '自定义技术指标创作指南：根据用户自然语言需求生成符合契约的指标代码（TD9/SuperTrend/OBV+MA等），并通过 indicator_author 工具验证与落库。',
  invocation: { modelInvocable: true, userInvocable: true },
  provider: PROVIDER_NAME,
  source: 'bundled',
  resourceBase: RESOURCE_BASE,
  rank: BUNDLED_SKILL_RANK,
  locator: AUTHORING_BODY_URL,
}

const STRATEGY_CANDIDATE: BundledSkillCandidate = {
  name: 'trading-strategy-paradigms',
  description: '经典交易策略参考范式指南：提供短线（唐奇安突破/RSI极值回归）、波段（EMA双均线/布林带下轨回归）、长线（200日均线基线/12月动量）6大策略原理、参数调优、8项回测指标研读与风险防范 SOP。',
  invocation: { modelInvocable: true, userInvocable: true },
  provider: PROVIDER_NAME,
  source: 'bundled',
  resourceBase: RESOURCE_BASE,
  rank: BUNDLED_SKILL_RANK,
  locator: STRATEGY_BODY_URL,
}

const KNOWLEDGE_CURATION_CANDIDATE: BundledSkillCandidate = {
  name: 'knowledge-curation',
  description: '财经观点沉淀与知识库策展指南：基于 Content Insight 事实核查产物，规范化提取知识卡片字段、受控词表对齐、查重与关联建立，通过 knowledge_ingest 工具入库。',
  invocation: { modelInvocable: true, userInvocable: true },
  provider: PROVIDER_NAME,
  source: 'bundled',
  resourceBase: RESOURCE_BASE,
  rank: BUNDLED_SKILL_RANK,
  locator: KNOWLEDGE_CURATION_BODY_URL,
}

const JOURNAL_CANDIDATE: BundledSkillCandidate = {
  name: 'trading-notes-setup',
  description:
    '交易日志建立与记录规范：检查/创建工作区 .trading-journal/ 双轨目录（agent 轨 + human 轨），分别记录 agent 与人类各自的操作。会话启动检查发现工作区没有交易日志目录时调用本技能建立骨架；记录条目格式以本技能为权威。',
  invocation: { modelInvocable: true, userInvocable: true },
  provider: PROVIDER_NAME,
  source: 'bundled',
  resourceBase: RESOURCE_BASE,
  rank: BUNDLED_SKILL_RANK,
  locator: JOURNAL_BODY_URL,
}

const SKILL_CANDIDATES: BundledSkillCandidate[] = [
  RISK_CHECKLIST_CANDIDATE,
  AUTHORING_CANDIDATE,
  STRATEGY_CANDIDATE,
  KNOWLEDGE_CURATION_CANDIDATE,
  JOURNAL_CANDIDATE,
]

export const provider: SkillProvider = {
  name: PROVIDER_NAME,
  list: () => Promise.resolve(SKILL_CANDIDATES),
  async get(candidate, _options): Promise<SkillDefinition> {
    const target = SKILL_CANDIDATES.find((c) => c.name === candidate.name) ?? RISK_CHECKLIST_CANDIDATE
    return {
      name: target.name,
      description: target.description,
      invocation: target.invocation,
      provider: target.provider,
      source: target.source,
      resourceBase: RESOURCE_BASE,
      content: await readFile(target.locator, 'utf8'),
    }
  },
}

export type Config = KitConfig
export const Config: Schema<Config> = kitConfigSchema()

export const inject = ['skills']

export const name = 'dsh-trading-ru-kit'

/** 白名单视图（三态语义与注册骨架见 @dshtrading/base/role-skills）。 */
export const providerForSkills = skillWhitelistView(provider, SKILL_CANDIDATES, kitSkillMessages(PROVIDER_NAME))

export function apply(ctx: Context, config: Config): void {
  registerSkillProvider(ctx, config, providerForSkills)
}

export { aggregateNews } from './news.ts'
