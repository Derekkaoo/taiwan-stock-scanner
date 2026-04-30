// ============================================================
//  個股 detail：進場分析面板
//  顯示「過去多頭觸發後，4 種進場 × 3 種退場」的統計
//  - Level 1：一句話結論（最佳進場 + 風報比）
//  - Level 2：4×1 對比表 + 退場規則 toggle
//  - Level 3：可展開各事件明細
// ============================================================
import { useState } from 'react'
import type { EntryAnalysis, EntryStrategy, ExitStrategy } from '../types'
import { ENTRY_LABELS, EXIT_LABELS } from '../types'

interface Props {
  data: EntryAnalysis | null
  loading: boolean
}

const ENTRY_KEYS: EntryStrategy[] = ['breakout', 'ma5', 'ma10', 'ma20']
const EXIT_KEYS:  ExitStrategy[]  = ['ma5', 'ma10', 'ma20']

function fmtPct(v: number | null | undefined, withSign = true): string {
  if (v == null) return '-'
  const sign = withSign && v >= 0 ? '+' : ''
  return `${sign}${v.toFixed(2)}%`
}

function fmtRR(v: number | null | undefined): string {
  if (v == null) return '-'
  return v.toFixed(2)
}

export function EntryAnalysisPanel({ data, loading }: Props) {
  const [exit, setExit] = useState<ExitStrategy>('ma20')
  const [showEvents, setShowEvents] = useState(false)

  if (loading) {
    return <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>載入進場分析中…</div>
  }
  if (!data || data.sampleSize === 0) {
    return <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>過去無多頭觸發事件 / 樣本不足</div>
  }

  const N = data.sampleSize
  const sampleWarn = N < 5 ? `⚠ 樣本偏少 (N=${N})，僅供參考`
                  : N < 10 ? `樣本中等 (N=${N})`
                  : `樣本充足 (N=${N})`
  const best = data.best

  return (
    <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
      {/* Level 1：一句話結論 */}
      {best && (
        <div
          className="rounded px-3 py-2"
          style={{
            background: 'var(--color-bg-600)',
            borderLeft: '3px solid var(--color-accent-cyan)',
          }}
        >
          <div className="text-xs font-bold mb-1" style={{ color: 'var(--color-text-primary)' }}>
            💡 最佳進場：<span style={{ color: 'var(--color-accent-cyan)' }}>
              {ENTRY_LABELS[best.entry]}
            </span>
            <span className="mx-1" style={{ color: 'var(--color-text-muted)' }}>+</span>
            <span style={{ color: 'var(--color-accent-cyan)' }}>
              {EXIT_LABELS[best.exit]}場
            </span>
          </div>
          <div className="text-[11px] flex items-center gap-3" style={{ color: 'var(--color-text-secondary)' }}>
            <span>勝率 <b style={{ color: 'var(--color-text-primary)' }}>{(best.winRate * 100).toFixed(0)}%</b></span>
            <span>平均 <b style={{ color: best.avgReturn >= 0 ? 'var(--color-up)' : 'var(--color-down)' }}>
              {fmtPct(best.avgReturn)}
            </b></span>
            <span>MAE <b style={{ color: 'var(--color-down)' }}>{fmtPct(best.avgMae)}</b></span>
            <span>風報比 <b style={{ color: 'var(--color-accent-cyan)' }}>{fmtRR(best.rrRatio)}</b></span>
          </div>
          <div className="text-[10px] mt-1" style={{ color: N < 5 ? 'var(--color-down)' : 'var(--color-text-muted)' }}>
            {sampleWarn}
          </div>
        </div>
      )}

      {/* Level 2：退場規則 toggle */}
      <div className="flex items-center gap-2 text-[10px]">
        <span style={{ color: 'var(--color-text-muted)' }}>退場規則：</span>
        {EXIT_KEYS.map(e => {
          const active = exit === e
          return (
            <button
              key={e}
              onClick={() => setExit(e)}
              className="px-2 py-0.5 rounded-full border transition-colors"
              style={{
                background:  active ? 'var(--color-accent-cyan)' : 'var(--color-bg-600)',
                borderColor: active ? 'var(--color-accent-cyan)' : 'var(--color-border)',
                color:       active ? '#fff' : 'var(--color-text-secondary)',
                fontWeight:  active ? 600 : 400,
                cursor: 'pointer',
              }}
            >
              {EXIT_LABELS[e]}
            </button>
          )
        })}
      </div>

      {/* Level 2：4×1 對比表 */}
      <table className="w-full text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
        <thead>
          <tr style={{ color: 'var(--color-text-muted)' }}>
            <th className="text-left pb-1 pr-2 font-normal">進場時機</th>
            <th className="text-right pb-1 pr-2 font-normal">筆數</th>
            <th className="text-right pb-1 pr-2 font-normal">勝率</th>
            <th className="text-right pb-1 pr-2 font-normal">平均報酬</th>
            <th className="text-right pb-1 pr-2 font-normal">平均MAE</th>
            <th className="text-right pb-1 font-normal">風報比</th>
          </tr>
        </thead>
        <tbody>
          {ENTRY_KEYS.map(entryKey => {
            const s = data.strategies[entryKey]?.[exit]
            const isBest = best != null && best.entry === entryKey && best.exit === exit
            if (!s || s.count === 0) {
              return (
                <tr key={entryKey} style={{ color: 'var(--color-text-muted)', borderTop: '1px solid var(--color-border)' }}>
                  <td className="py-1 pr-2">{ENTRY_LABELS[entryKey]}</td>
                  <td className="py-1 pr-2 text-right">0</td>
                  <td colSpan={4} className="py-1 text-right text-[10px]">— 從未觸發</td>
                </tr>
              )
            }
            return (
              <tr key={entryKey} style={{
                borderTop: '1px solid var(--color-border)',
                background: isBest ? 'rgba(34, 211, 238, 0.06)' : 'transparent',
              }}>
                <td className="py-1 pr-2 font-medium" style={{ color: isBest ? 'var(--color-accent-cyan)' : undefined }}>
                  {ENTRY_LABELS[entryKey]}{isBest && ' ✨'}
                </td>
                <td className="py-1 pr-2 text-right">{s.count}</td>
                <td className="py-1 pr-2 text-right">{((s.winRate ?? 0) * 100).toFixed(0)}%</td>
                <td className="py-1 pr-2 text-right" style={{ color: (s.avgReturn ?? 0) >= 0 ? 'var(--color-up)' : 'var(--color-down)' }}>
                  {fmtPct(s.avgReturn)}
                </td>
                <td className="py-1 pr-2 text-right" style={{ color: 'var(--color-down)' }}>
                  {fmtPct(s.avgMae)}
                </td>
                <td className="py-1 text-right font-bold" style={{ color: 'var(--color-accent-cyan)' }}>
                  {fmtRR(s.rrRatio)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* Level 3：事件明細（可展開）*/}
      <div>
        <button
          onClick={() => setShowEvents(!showEvents)}
          className="text-[10px] underline"
          style={{ color: 'var(--color-text-muted)', cursor: 'pointer' }}
        >
          {showEvents ? '▲ 收起' : `▼ 看 ${N} 次歷史明細`}
        </button>
        {showEvents && (
          <div className="mt-2 space-y-2">
            {data.events.map((ev, i) => {
              const exitInfo = ev.exits[exit]
              return (
                <div key={i} className="text-[10px] rounded px-2 py-1.5"
                  style={{ background: 'var(--color-bg-600)', borderLeft: '2px solid var(--color-border)' }}>
                  <div className="font-medium mb-1" style={{ color: 'var(--color-text-primary)' }}>
                    {ev.triggerDate} 觸發 @{ev.triggerClose}
                    {ev.ongoing && <span className="ml-2" style={{ color: 'var(--color-accent-cyan)' }}>(進行中)</span>}
                    <span className="ml-2 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                      → {EXIT_LABELS[exit]}場 {exitInfo.date} @{exitInfo.close}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                    {ENTRY_KEYS.map(entryKey => {
                      const e = ev[entryKey]
                      if (!e) {
                        return (
                          <div key={entryKey} style={{ color: 'var(--color-text-muted)' }}>
                            {ENTRY_LABELS[entryKey]}: 從未觸發
                          </div>
                        )
                      }
                      const r = e.byExit[exit]
                      if (!r) {
                        return (
                          <div key={entryKey} style={{ color: 'var(--color-text-muted)' }}>
                            {ENTRY_LABELS[entryKey]}: —
                          </div>
                        )
                      }
                      return (
                        <div key={entryKey}>
                          <span style={{ color: 'var(--color-text-secondary)' }}>{ENTRY_LABELS[entryKey]}</span>
                          {' @'}{e.entryClose}
                          {' → '}
                          <span style={{ color: r.returnPct >= 0 ? 'var(--color-up)' : 'var(--color-down)' }}>
                            {fmtPct(r.returnPct)}
                          </span>
                          <span className="ml-1" style={{ color: 'var(--color-text-muted)' }}>
                            (MAE {fmtPct(r.maePct)})
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
