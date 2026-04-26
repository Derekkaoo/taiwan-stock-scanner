// ============================================================
//  產業別 chip 多選（OR 邏輯）
//  - 顏色統一：active = cyan、inactive = 灰
//  - 預設折疊：先顯示 top N（按股票數），按「展開」秀全部
//  - selected = [] 視為「不篩」
// ============================================================
import { useMemo, useState } from 'react'
import type { StockRow } from '../types'

interface Props {
  stocks:   StockRow[]
  selected: string[]
  onChange: (next: string[]) => void
}

const COLLAPSED_COUNT = 8

export function IndustryChips({ stocks, selected, onChange }: Props) {
  const [expanded, setExpanded] = useState(false)

  const industries = useMemo(() => {
    const counter = new Map<string, number>()
    for (const s of stocks) {
      const gs = (s.groups && s.groups.length > 0) ? s.groups : [s.group]
      for (const g of gs) {
        if (!g) continue
        counter.set(g, (counter.get(g) ?? 0) + 1)
      }
    }
    return [...counter.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }))
  }, [stocks])

  const toggle = (name: string) => {
    if (selected.includes(name)) onChange(selected.filter(n => n !== name))
    else                          onChange([...selected, name])
  }
  const clear = () => onChange([])

  // 折疊：未展開時取前 N 個，但「已選」即使在後段也要露出
  const visible = useMemo(() => {
    if (expanded) return industries
    const top = new Set(industries.slice(0, COLLAPSED_COUNT).map(x => x.name))
    return industries.filter((x, i) => i < COLLAPSED_COUNT || top.has(x.name) || selected.includes(x.name))
  }, [expanded, industries, selected])

  const hiddenCount = industries.length - visible.length

  return (
    <div className="flex items-center gap-1 flex-wrap">
      <span className="text-[10px] mr-1" style={{ color: 'var(--color-text-muted)' }}>產業</span>
      <button
        onClick={clear}
        className="text-[10px] px-2 py-0.5 rounded-full border transition-colors"
        style={{
          background:  selected.length === 0 ? 'var(--color-accent-cyan)' : 'var(--color-bg-600)',
          borderColor: selected.length === 0 ? 'var(--color-accent-cyan)' : 'var(--color-border)',
          color:       selected.length === 0 ? '#fff' : 'var(--color-text-secondary)',
          fontWeight:  selected.length === 0 ? 600 : 400,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        全部 ({stocks.length})
      </button>
      {visible.map(({ name, count }) => {
        const active = selected.includes(name)
        return (
          <button
            key={name}
            onClick={() => toggle(name)}
            className="text-[10px] px-2 py-0.5 rounded-full border transition-colors"
            style={{
              background:  active ? 'var(--color-accent-cyan)' : 'var(--color-bg-600)',
              borderColor: active ? 'var(--color-accent-cyan)' : 'var(--color-border)',
              color:       active ? '#fff' : 'var(--color-text-secondary)',
              fontWeight:  active ? 600 : 400,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
            title={`${name}（${count} 支）`}
          >
            {name} <span style={{ opacity: 0.7, fontSize: 9 }}>{count}</span>
          </button>
        )
      })}
      {industries.length > COLLAPSED_COUNT && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="text-[10px] px-2 py-0.5 rounded-full border transition-colors"
          style={{
            background: 'transparent',
            borderColor: 'var(--color-border)',
            color: 'var(--color-text-secondary)',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {expanded ? '收起 ▲' : `展開全部 +${hiddenCount} ▼`}
        </button>
      )}
    </div>
  )
}
