// ============================================================
//  K 線資料聚合（日 → 週 / 月）
//
//  輸入：日 K 線陣列（時間升序，date 格式 YYYY/MM/DD 或 YYYY-MM-DD）
//  輸出：聚合後的 K 線陣列（時間升序，最末根可能未完成）
//
//  聚合規則：
//    open  = 該週/月「第一個交易日」的開盤
//    close = 該週/月「最後一個交易日」的收盤
//    high  = 該週/月所有 high 的最大值
//    low   = 該週/月所有 low 的最小值
//    volume = 該週/月所有 volume 加總
//    date  = 該週/月「最後一個交易日」（給 X 軸顯示用）
// ============================================================
import type { KlineBar } from '../types'

function parseDate(s: string): Date {
  const norm = s.replace(/-/g, '/')
  const [y, m, d] = norm.split('/').map(Number)
  return new Date(y, m - 1, d)
}

/** 取週一日期作為 week key（YYYY-MM-DD）。這支跨年也安全。 */
function getWeekKey(date: Date): string {
  const d = new Date(date)
  const day = d.getDay()                            // 0=Sun, 1=Mon, ..., 6=Sat
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) // 回退到本週週一
  d.setDate(diff)
  const yy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

function getMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function aggregate(bars: KlineBar[], keyFn: (date: Date) => string): KlineBar[] {
  if (!bars || bars.length === 0) return []
  const groups = new Map<string, KlineBar[]>()
  for (const bar of bars) {
    const date = parseDate(bar.date)
    const key = keyFn(date)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(bar)
  }
  // groups 維持插入順序（K 線本身已升序），不需另外排序
  const result: KlineBar[] = []
  for (const [, grp] of groups) {
    result.push({
      date: grp[grp.length - 1].date,
      o: grp[0].o,
      h: Math.max(...grp.map(b => b.h)),
      l: Math.min(...grp.map(b => b.l)),
      c: grp[grp.length - 1].c,
      v: grp.reduce((s, b) => s + b.v, 0),
    })
  }
  return result
}

export function aggregateWeekly(bars: KlineBar[]): KlineBar[] {
  return aggregate(bars, getWeekKey)
}

export function aggregateMonthly(bars: KlineBar[]): KlineBar[] {
  return aggregate(bars, getMonthKey)
}

export type Timeframe = 'D' | 'W' | 'M'

/** 依 timeframe 聚合並回傳「顯示用」的 K 線陣列（已切到最後 N 根）。 */
export function aggregateForTimeframe(bars: KlineBar[], tf: Timeframe): {
  full:    KlineBar[]   // 聚合後完整陣列（給 MA 算）
  display: KlineBar[]   // 切到最後 N 根（給渲染用）
} {
  let full: KlineBar[]
  let displayN: number
  if (tf === 'W') {
    full = aggregateWeekly(bars)
    displayN = 60   // 約 1.2 年
  } else if (tf === 'M') {
    full = aggregateMonthly(bars)
    displayN = 36   // 3 年
  } else {
    full = bars
    displayN = 90   // 約 4.5 個月
  }
  const display = full.slice(-displayN)
  return { full, display }
}
