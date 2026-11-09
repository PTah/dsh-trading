/** Market bundle capability source. @dshtrading/base/presets is the sole preset writer. */
import { readFile } from 'node:fs/promises'
import Schema from '@deepseek-ai/schemastery'
export const name = 'dsh-trading-ru-installer'
export interface Config { presetRoot?: string }
// Retain the old host row/config for profile compatibility, but never write legacy presets.
export const Config: Schema<Config> = Schema.object({ presetRoot: Schema.string() })
export async function getPresetContribution() {
  // Normalize CRLF: Windows checkouts (autocrlf) turn the asset into CRLF and the LF-anchored indexOf below would miss. Rows handed to base/presets stay LF.
  const asset = (await readFile(new URL('../assets/preset/ru-trader/agent.cordis.yml', import.meta.url), 'utf8')).replace(/\r\n/g, '\n')
  const start = asset.indexOf('- id: dsh-trading-ru-connector-tbank-group\n')
  if (start < 0) throw new Error('Missing ru capability rows')
  return { market: 'ru' as const, traderRows: asset.slice(start) }
}
export function apply(): void {}
