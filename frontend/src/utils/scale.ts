// ============================================================
//  分段刻度 helper
//  用在 RangeSlider 想做「越右跳越快」的 slider 時
//  例：市值 0~5000 億，breakpoints = [0, 50, 200, 1000, 5000]
//    → slider 左邊 1/4 走完 0~50（小公司精準），右邊 1/4 走完 1000~5000
// ============================================================

export interface PiecewiseScale {
  /** 把實際值轉成 slider 位置（0~1） */
  toSlider:   (value: number) => number
  /** 把 slider 位置（0~1）轉回實際值 */
  fromSlider: (pos:   number) => number
  /** 給 slider <input range> 用：固定 step（位置精度），預設 0.001 = 1000 段 */
  step:       number
}

/**
 * 分段線性刻度。
 * breakpoints 必須是嚴格遞增的數列（≥ 2 個點），
 * 第一個是 min、最後一個是 max。
 *
 * slider 位置 0~1 被等分成 (N-1) 段，每段線性映射到對應的 breakpoint 區間。
 */
export function makePiecewiseScale(breakpoints: number[], step = 0.001): PiecewiseScale {
  if (breakpoints.length < 2) throw new Error('breakpoints 至少 2 個點')
  const pts  = breakpoints.slice()
  const segN = pts.length - 1
  const segLen = 1 / segN

  const fromSlider = (pos: number): number => {
    if (pos <= 0) return pts[0]
    if (pos >= 1) return pts[segN]
    const i = Math.min(segN - 1, Math.floor(pos / segLen))
    const localPos = (pos - i * segLen) / segLen   // 0~1 in segment
    return pts[i] + (pts[i + 1] - pts[i]) * localPos
  }

  const toSlider = (value: number): number => {
    if (value <= pts[0])    return 0
    if (value >= pts[segN]) return 1
    for (let i = 0; i < segN; i++) {
      if (value <= pts[i + 1]) {
        const localPos = (value - pts[i]) / (pts[i + 1] - pts[i])
        return (i + localPos) * segLen
      }
    }
    return 1
  }

  return { toSlider, fromSlider, step }
}

/**
 * 線性刻度（給其他 slider 直接用，介面統一）
 */
export function makeLinearScale(min: number, max: number, step = 0.001): PiecewiseScale {
  return {
    toSlider:   v => (v - min) / (max - min),
    fromSlider: p => min + p * (max - min),
    step,
  }
}

/**
 * 對齊到指定步距（例如步距 0.1 → 1.234 → 1.2）
 */
export function snap(value: number, stepSize: number): number {
  return Math.round(value / stepSize) * stepSize
}
