/**
 * 预置/社区指标的 title、输出 key、参数 label 在定义里是中文（契约键，测试锁定）。
 * 俄文终端只在渲染层替换可见文案，不改 compute 的 key。
 */
const EXACT: Record<string, string> = {
  成交量: 'Объём',
  上涨量: 'Рост',
  下跌量: 'Падение',
  量比分档量能: 'Объём по отношению',
  无前值: 'Нет базы',
  '量比<1': 'Отношение < 1',
  '量比1-2': '1–2',
  '量比2-3': '2–3',
  '量比≥3': '≥ 3',
  超级趋势: 'SuperTrend',
  港股通持股比例: 'Доля Stock Connect',
  主动买盘: 'Активные покупки',
  净买: 'Нетто-покупки',
  买占: 'Доля покупок',
  周期: 'Период',
  倍数: 'Множитель',
}

/** 可见文案：已知中文标签 → 俄文；其余原样（MA/EMA/MACD 等拉丁名不动）。 */
export function ruIndicatorLabel(text: string): string {
  const exact = EXACT[text]
  if (exact !== undefined) return exact
  const period = /^周期(\d+)$/.exec(text)
  if (period) return `Период ${period[1]}`
  return text
}
