import { useState, useEffect, useCallback } from 'react'
import {
  listStrategies,
  createStrategy,
  updateStrategy,
  deleteStrategy,
  type Strategy,
} from '../api/strategies'
import type { Filters } from '../types'

interface UseStrategiesOptions {
  /** 已達上限（5）時 → 觸發此 callback（用來顯示「升級 VIP」modal） */
  onLimitExceeded?: () => void
}

/**
 * useStrategies — 管理已登入使用者的篩選策略列表
 *
 * - idToken 為 null 時不會打 API、回傳空陣列
 * - idToken 改變時會重抓
 * - 提供 create / rename / overwrite / remove 函式
 */
export function useStrategies(
  idToken: string | null,
  opts?: UseStrategiesOptions,
) {
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!idToken) {
      setStrategies([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const list = await listStrategies(idToken)
      setStrategies(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed')
    } finally {
      setLoading(false)
    }
  }, [idToken])

  useEffect(() => {
    refresh()
  }, [refresh])

  const create = useCallback(
    async (name: string, filters: Filters): Promise<Strategy | null> => {
      if (!idToken) return null
      setError(null)
      try {
        const s = await createStrategy(idToken, name, filters)
        setStrategies(prev => [s, ...prev])
        return s
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'create failed'
        if (msg === 'limit_exceeded') {
          opts?.onLimitExceeded?.()
        } else {
          setError(msg)
        }
        return null
      }
    },
    [idToken, opts],
  )

  const rename = useCallback(
    async (id: number, name: string): Promise<boolean> => {
      if (!idToken) return false
      setError(null)
      try {
        await updateStrategy(idToken, id, { name })
        setStrategies(prev =>
          prev.map(s =>
            s.id === id ? { ...s, name, updated_at: Math.floor(Date.now() / 1000) } : s,
          ),
        )
        return true
      } catch (e) {
        setError(e instanceof Error ? e.message : 'rename failed')
        return false
      }
    },
    [idToken],
  )

  const overwrite = useCallback(
    async (id: number, filters: Filters): Promise<boolean> => {
      if (!idToken) return false
      setError(null)
      try {
        await updateStrategy(idToken, id, { filters })
        setStrategies(prev =>
          prev.map(s =>
            s.id === id ? { ...s, filters, updated_at: Math.floor(Date.now() / 1000) } : s,
          ),
        )
        return true
      } catch (e) {
        setError(e instanceof Error ? e.message : 'overwrite failed')
        return false
      }
    },
    [idToken],
  )

  const remove = useCallback(
    async (id: number): Promise<boolean> => {
      if (!idToken) return false
      setError(null)
      try {
        await deleteStrategy(idToken, id)
        setStrategies(prev => prev.filter(s => s.id !== id))
        return true
      } catch (e) {
        setError(e instanceof Error ? e.message : 'delete failed')
        return false
      }
    },
    [idToken],
  )

  return {
    strategies,
    loading,
    error,
    refresh,
    create,
    rename,
    overwrite,
    remove,
  }
}
