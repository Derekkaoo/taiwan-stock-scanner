import { useState, useEffect, useCallback, useRef } from 'react'
import { fetchFavorites, addFavorite, removeFavorite, getUserToken } from '../api/favorites'

const MIGRATED_KEY_PREFIX = 'stock-scanner-favs-migrated-'

interface UseFavoritesOptions {
  /** 未登入時點 ⭐ 加入最愛 → 觸發此 callback（用來顯示「請先登入」modal） */
  onLoginRequired?: () => void
  /** 已達上限（10）時 → 觸發此 callback（用來顯示「升級 VIP」modal） */
  onLimitExceeded?: () => void
}

/**
 * useFavorites
 *  - 未登入：可看現有 UUID 收藏，但點 ⭐ 加新的會跳「請先登入」
 *  - 已登入：用 Google ID Token，跨裝置同步
 *  - 切換登入狀態時自動重抓
 *  - 首次登入到某個 Google 帳號時，把當下 UUID 收藏自動 merge 上雲
 *  - 樂觀更新：點 ⭐ 立即改 UI，背景送 API；失敗 rollback
 */
export function useFavorites(
  idToken: string | null,
  userSub: string | null,
  opts?: UseFavoritesOptions,
) {
  const [favorites, setFavorites] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const migratedRef = useRef<Set<string>>(new Set())  // 已 migrate 過的 sub，避免重複

  // 載入「已 migrate sub」清單
  useEffect(() => {
    try {
      // 用單一 key 存「已 merge 的 sub 清單」
      const stored = localStorage.getItem('stock-scanner-favs-migrated-list')
      if (stored) {
        const arr = JSON.parse(stored)
        if (Array.isArray(arr)) migratedRef.current = new Set(arr)
      }
    } catch {}
  }, [])

  const markMigrated = useCallback((sub: string) => {
    migratedRef.current.add(sub)
    try {
      localStorage.setItem(
        'stock-scanner-favs-migrated-list',
        JSON.stringify([...migratedRef.current]),
      )
      // 額外標記（debug 用），舊版相容
      localStorage.setItem(MIGRATED_KEY_PREFIX + sub, '1')
    } catch {}
  }, [])

  // 拉取 + (登入第一次) merge
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    const load = async () => {
      try {
        // Step 1：先拉雲端目前 favs（依當下 token 對應的 user_token）
        const cloudList = await fetchFavorites(idToken)
        if (cancelled) return
        let combined = new Set(cloudList)

        // Step 2：登入後第一次 → 把本機 UUID 的 favs merge 進雲端
        if (idToken && userSub && !migratedRef.current.has(userSub)) {
          // 拿本機 UUID 的 favs（unauthenticated bearer）
          const localList = await fetchFavorites(null).catch(() => [] as string[])
          if (cancelled) return
          const toMerge = localList.filter(id => !combined.has(id))
          if (toMerge.length > 0) {
            // 並發送到雲端（已登入帳號）
            await Promise.allSettled(toMerge.map(id => addFavorite(id, idToken)))
            if (cancelled) return
            toMerge.forEach(id => combined.add(id))
          }
          markMigrated(userSub)
        }

        if (!cancelled) setFavorites(combined)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'load failed')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [idToken, userSub, markMigrated])

  const isFavorite = useCallback(
    (stockId: string) => favorites.has(stockId),
    [favorites]
  )

  const toggle = useCallback(async (stockId: string) => {
    const wasIn = favorites.has(stockId)

    // 未登入 + 嘗試新增 → 跳「請先登入」（不做任何動作）
    if (!wasIn && !idToken) {
      opts?.onLoginRequired?.()
      return
    }

    // 樂觀更新
    setFavorites(prev => {
      const next = new Set(prev)
      if (wasIn) next.delete(stockId)
      else next.add(stockId)
      return next
    })

    try {
      if (wasIn) {
        await removeFavorite(stockId, idToken)
      } else {
        await addFavorite(stockId, idToken)
      }
    } catch (e) {
      // 失敗：rollback
      setFavorites(prev => {
        const next = new Set(prev)
        if (wasIn) next.add(stockId)
        else next.delete(stockId)
        return next
      })
      const msg = e instanceof Error ? e.message : 'Toggle 失敗'
      if (msg === 'limit_exceeded') {
        opts?.onLimitExceeded?.()
      } else {
        setError(msg)
      }
    }
  }, [favorites, idToken, opts])

  // 觸發 token 確認（getUserToken 也會自己生成）
  useEffect(() => { getUserToken() }, [])

  return {
    favorites,
    favoritesArray: Array.from(favorites),
    count: favorites.size,
    loading,
    error,
    isFavorite,
    toggle,
    /** 提示 UI：是否在跨裝置同步模式 */
    isSynced: !!idToken,
  }
}
