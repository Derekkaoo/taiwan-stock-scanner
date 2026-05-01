import { useState, useMemo } from 'react'
import { useStrategies } from '../hooks/useStrategies'
import type { Filters } from '../types'
import { DEFAULT_FILTERS } from '../types'

/**
 * StrategyManager — 篩選策略管理介面
 *
 * 已登入時：
 *   - 下拉選單顯示已存策略
 *   - 「儲存目前條件」按鈕
 *   - 選某個策略 → 自動套用 filters 並通知 parent
 *   - 「覆蓋」「改名」「刪除」三個小按鈕
 *
 * 未登入時：null
 *
 * 樣式：跟整個 app 的深色主題一致（var(--color-bg-600) etc.）
 */
interface Props {
  idToken: string | null
  filters: Filters
  setFilters: (f: Filters) => void
}

/**
 * 把存在 server 的 filters 跟最新 DEFAULT_FILTERS 合併（深層）。
 * 為了避免 schema 升級後舊策略缺欄位導致 React render 炸掉。
 */
function applyServerFilters(saved: Partial<Filters> | undefined): Filters {
  const f = (saved || {}) as Partial<Filters>
  return {
    ...DEFAULT_FILTERS,
    ...f,
    growth: {
      ...DEFAULT_FILTERS.growth,
      ...(f.growth || {}),
      metrics: {
        ...DEFAULT_FILTERS.growth.metrics,
        ...((f.growth && f.growth.metrics) || {}),
      },
    },
    absValue: {
      ...DEFAULT_FILTERS.absValue,
      ...(f.absValue || {}),
    },
    institutional: {
      ...DEFAULT_FILTERS.institutional,
      ...(f.institutional || {}),
    },
  }
}

const styles = {
  select: {
    background: 'var(--color-bg-600)',
    borderColor: 'var(--color-border)',
    color: 'var(--color-text-primary)',
    // 關鍵：拿掉瀏覽器預設外觀，自畫下拉箭頭
    appearance: 'none',
    WebkitAppearance: 'none',
    MozAppearance: 'none',
    // 通知瀏覽器這是深色 UI（讓下拉開啟後的 option list 也走深色）
    colorScheme: 'dark',
    // 自畫一個小箭頭（SVG data URI，淺灰色）
    backgroundImage:
      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23a0a8b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E\")",
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 6px center',
    paddingRight: 24,
  } as React.CSSProperties,
  primaryBtn: {
    background: 'var(--color-accent-cyan)',
    borderColor: 'var(--color-accent-cyan)',
    color: '#fff',
  } as React.CSSProperties,
  ghostBtn: {
    background: 'var(--color-bg-600)',
    borderColor: 'var(--color-border)',
    color: 'var(--color-text-secondary)',
  } as React.CSSProperties,
  dangerBtn: {
    background: 'var(--color-bg-600)',
    borderColor: 'var(--color-accent-red)' + '66',
    color: 'var(--color-accent-red)',
  } as React.CSSProperties,
  input: {
    background: 'var(--color-bg-600)',
    borderColor: 'var(--color-accent-cyan)',
    color: 'var(--color-text-primary)',
  } as React.CSSProperties,
}

export function StrategyManager({ idToken, filters, setFilters }: Props) {
  const { strategies, loading, error, create, rename, overwrite, remove } =
    useStrategies(idToken)

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [mode, setMode] = useState<'idle' | 'naming' | 'renaming'>('idle')
  const [draftName, setDraftName] = useState('')

  const selected = useMemo(
    () => strategies.find(s => s.id === selectedId) || null,
    [strategies, selectedId],
  )

  if (!idToken) return null

  const onSelect = (idStr: string) => {
    if (idStr === '') {
      setSelectedId(null)
      return
    }
    const id = Number(idStr)
    setSelectedId(id)
    const s = strategies.find(x => x.id === id)
    if (s) {
      const next = applyServerFilters(s.filters as Partial<Filters>)
      setFilters(next)
    }
  }

  const onSaveNew = async () => {
    const name = draftName.trim()
    if (!name) return
    const created = await create(name, filters)
    if (created) {
      setSelectedId(created.id)
      setMode('idle')
      setDraftName('')
    }
  }

  const onRename = async () => {
    if (!selected) return
    const name = draftName.trim()
    if (!name) return
    const ok = await rename(selected.id, name)
    if (ok) {
      setMode('idle')
      setDraftName('')
    }
  }

  const onOverwrite = async () => {
    if (!selected) return
    if (!confirm(`確定要覆蓋「${selected.name}」為目前的篩選條件？`)) return
    await overwrite(selected.id, filters)
  }

  const onRemove = async () => {
    if (!selected) return
    if (!confirm(`確定要刪除策略「${selected.name}」？`)) return
    const ok = await remove(selected.id)
    if (ok) setSelectedId(null)
  }

  return (
    <div className="flex flex-wrap items-center gap-2" style={{ fontSize: 12 }}>
      <span style={{ color: 'var(--color-text-muted)' }}>策略：</span>

      <select
        value={selectedId ?? ''}
        onChange={e => onSelect(e.target.value)}
        disabled={loading || mode !== 'idle'}
        className="px-2 py-1 border rounded outline-none cursor-pointer"
        style={{ ...styles.select, maxWidth: 180 }}
      >
        <option value="">— 選擇 —</option>
        {strategies.map(s => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>

      {/* idle 模式：顯示動作按鈕 */}
      {mode === 'idle' && (
        <>
          <button
            onClick={() => {
              setDraftName('')
              setMode('naming')
            }}
            className="px-2 py-1 rounded border transition-colors"
            style={styles.primaryBtn}
            title="把目前篩選條件存為新策略"
          >
            ＋ 儲存目前條件
          </button>

          {selected && (
            <>
              <button
                onClick={onOverwrite}
                className="px-2 py-1 rounded border transition-colors"
                style={styles.ghostBtn}
                title="用目前條件覆蓋"
              >
                覆蓋
              </button>
              <button
                onClick={() => {
                  setDraftName(selected.name)
                  setMode('renaming')
                }}
                className="px-2 py-1 rounded border transition-colors"
                style={styles.ghostBtn}
              >
                改名
              </button>
              <button
                onClick={onRemove}
                className="px-2 py-1 rounded border transition-colors"
                style={styles.dangerBtn}
              >
                刪除
              </button>
            </>
          )}
        </>
      )}

      {/* naming / renaming 模式：inline input */}
      {mode !== 'idle' && (
        <>
          <input
            autoFocus
            type="text"
            value={draftName}
            onChange={e => setDraftName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                if (mode === 'naming') onSaveNew()
                else onRename()
              } else if (e.key === 'Escape') {
                setMode('idle')
                setDraftName('')
              }
            }}
            placeholder={mode === 'naming' ? '策略名稱' : '新名稱'}
            maxLength={50}
            className="px-2 py-1 border rounded outline-none"
            style={{ ...styles.input, width: 140 }}
          />
          <button
            onClick={mode === 'naming' ? onSaveNew : onRename}
            className="px-2 py-1 rounded border"
            style={styles.primaryBtn}
          >
            確認
          </button>
          <button
            onClick={() => {
              setMode('idle')
              setDraftName('')
            }}
            className="px-2 py-1 rounded border"
            style={styles.ghostBtn}
          >
            取消
          </button>
        </>
      )}

      {error && (
        <span style={{ color: 'var(--color-accent-red)', fontSize: 11 }} title={error}>
          ⚠ {error.length > 30 ? error.slice(0, 30) + '...' : error}
        </span>
      )}
    </div>
  )
}
