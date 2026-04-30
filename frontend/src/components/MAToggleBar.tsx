// ============================================================
//  K 線圖均線顯示開關（chip-style）
//  目前選中的 MA 會用對應顏色填滿；未選中的灰色框
// ============================================================
import { ALL_MA_PERIODS, MA_COLORS } from './CandlestickSVG'

interface Props {
  selected: number[]
  onChange: (selected: number[]) => void
}

export function MAToggleBar({ selected, onChange }: Props) {
  const toggle = (p: number) => {
    if (selected.includes(p)) {
      onChange(selected.filter(x => x !== p))
    } else {
      onChange([...selected, p].sort((a, b) => a - b))
    }
  }

  return (
    <div className="flex items-center flex-wrap gap-1.5 text-[10px]">
      <span style={{ color: 'var(--color-text-muted)' }}>均線：</span>
      {ALL_MA_PERIODS.map(p => {
        const active = selected.includes(p)
        const color = MA_COLORS[p]
        return (
          <button
            key={p}
            onClick={(e) => { e.stopPropagation(); toggle(p) }}
            className="transition-colors"
            style={{
              background:  active ? color : 'var(--color-bg-600)',
              color:       active ? '#fff' : 'var(--color-text-secondary)',
              border:      `1px solid ${active ? color : 'var(--color-border)'}`,
              borderRadius: 999,
              padding: '2px 8px',
              fontWeight: active ? 600 : 400,
              cursor: 'pointer',
              fontFamily: 'monospace',
            }}
          >
            MA{p}
          </button>
        )
      })}
    </div>
  )
}
