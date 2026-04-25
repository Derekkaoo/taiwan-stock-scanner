import { useState, useEffect, useCallback } from 'react'
import { fetchFavorites, addFavorite, removeFavorite } from '../api/favorites'

/**
 * useFavorites
 *  - 啟動時自動拉一次 server 上的最愛
 *  - 提供 toggle / isFavorite helper
 *  - 樂觀更新（optimistic update）：點 ⭐ 立即更新 UI，背景送 API
 */
export function useFavorites() {
  const [favorites, setFavorites] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 啟動時拉一次
  useEffect(() => {
    fetchFavorites()
      .then(list => setFavorites(new Set(list)))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const isFavorite = useCallback(
    (stockId: string) => favorites.has(stockId),
    [favorites]
  )

  const toggle = useCallback(async (stockId: string) => {
    const wasIn = favorites.has(stockId)

    // 樂觀更新：先改 UI
    setFavorites(prev => {
      const next = new Set(prev)
      if (wasIn) next.delete(stockId)
      else next.add(stockId)
      return next
    })

    // 背景送 API
    try {
      if (wasIn) {
        await removeFavorite(stockId)
      } else {
        await addFavorite(stockId)
      }
    } catch (e) {
      // 失敗：rollback
      setFavorites(prev => {
        const next = new Set(prev)
        if (wasIn) next.add(stockId)
        else next.delete(stockId)
        return next
      })
      setError(e instanceof Error ? e.message : 'Toggle 失敗')
    }
  }, [favorites])

  return {
    favorites,           // Set<string>
    favoritesArray: Array.from(favorites),
    count: favorites.size,
    loading,
    error,
    isFavorite,
    toggle,
  }
}
