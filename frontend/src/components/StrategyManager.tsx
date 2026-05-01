import { useState, useMemo } from 'react'
import { useStrategies } from '../hooks/useStrategies'
import type { Filters } from '../types'
import { DEFAULT_FILTERS } from '../types'

/**
 * StrategyManager — 篩選策略管理介面
 *
 * 已登入時：
 *   - 下拉選單顯示已存策略
 *   - 「儲存目前條件」按鈕：開 inline input 命名後 POST
 *   - 選某個策略 → 自動套用 filters 並通知 parent
 *   - 「覆蓋」「改名」「刪除」三個小按鈕
 *
 * 未登入時：null
 */
interface Props {
  idToken: string | null
  filters: Filters
  setFilters: (f: Filters) => void
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
      // 套用策略 filters；缺欄位用 DEFAULT_FILTERS 補
      setFilters({ ...DEFAULT_FILTERS, ...s.filters })
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
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-gray-600 font-medium">策略：</span>

      <select
        value={selectedId ?? ''}
        onChange={e => onSelect(e.target.value)}
        disabled={loading || mode !== 'idle'}
        className="px-2 py-1 border border-gray-300 rounded-md bg-white text-gray-700 max-w-[180px]"
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
            className="px-2 py-1 rounded-md bg-blue-600 text-white text-xs hover:bg-blue-700"
            title="把目前篩選條件存為新策略"
          >
            ＋ 儲存目前條件
          </button>

          {selected && (
            <>
              <button
                onClick={onOverwrite}
                className="px-2 py-1 rounded-md border border-gray-300 text-gray-600 text-xs hover:bg-gray-100"
                title="用目前條件覆蓋"
              >
                覆蓋
              </button>
              <button
                onClick={() => {
                  setDraftName(selected.name)
                  setMode('renaming')
                }}
                className="px-2 py-1 rounded-md border border-gray-300 text-gray-600 text-xs hover:bg-gray-100"
              >
                改名
              </button>
              <button
                onClick={onRemove}
                className="px-2 py-1 rounded-md border border-red-300 text-red-600 text-xs hover:bg-red-50"
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
            className="px-2 py-1 border border-blue-400 rounded-md text-gray-700 w-[140px]"
          />
          <button
            onClick={mode === 'naming' ? onSaveNew : onRename}
            className="px-2 py-1 rounded-md bg-blue-600 text-white text-xs hover:bg-blue-700"
          >
            確認
          </button>
          <button
            onClick={() => {
              setMode('idle')
              setDraftName('')
            }}
            className="px-2 py-1 rounded-md border border-gray-300 text-gray-600 text-xs hover:bg-gray-100"
          >
            取消
          </button>
        </>
      )}

      {error && (
        <span className="text-xs text-red-500" title={error}>
          ⚠ {error.length > 30 ? error.slice(0, 30) + '...' : error}
        </span>
      )}
    </div>
  )
}
