/** 图表可见窗口：最近 2/3/4/5/6/12 个日历月。不是 K 线周期。 */

export const CHART_MONTH_WINDOWS = [2, 3, 4, 5, 6, 12] as const

export type ChartMonthWindow = (typeof CHART_MONTH_WINDOWS)[number]

/** 同一时刻往前数 N 个日历月。月末夹到目标月的最后一天。 */
export function monthsBefore(ms: number, months: number): number {
  const date = new Date(ms)
  const day = date.getUTCDate()
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() - months)
  const dim = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
  date.setUTCDate(Math.min(day, dim))
  return date.getTime()
}

function barMs(time: number): number {
  return time > 1e11 ? time : time * 1000
}

/**
 * 窗口内第一根 bar 的下标。序列比窗口短时返回 0，调用方把现有的全部画出来。
 * `times` 升序，单位是秒或毫秒。
 */
export function monthWindowFromIndex(times: readonly number[], months: number): number {
  if (times.length === 0 || months <= 0) return 0
  const last = times[times.length - 1]
  if (last === undefined) return 0
  const cutoff = monthsBefore(barMs(last), months)
  for (let index = 0; index < times.length; index++) {
    const time = times[index]
    if (time !== undefined && barMs(time) >= cutoff) return index
  }
  return 0
}
