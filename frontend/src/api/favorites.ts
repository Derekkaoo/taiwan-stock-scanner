/**
 * Favorites API client
 * 跟 Cloudflare Pages Functions 的 /api/favorites 串接
 */

const API_BASE = '/api/favorites'

const TOKEN_KEY = 'stock-scanner-user-token'

/** 取得使用者 token；第一次訪問自動生成 UUID 存 localStorage */
export function getUserToken(): string {
  let token = localStorage.getItem(TOKEN_KEY)
  if (!token) {
    token = crypto.randomUUID()
    localStorage.setItem(TOKEN_KEY, token)
  }
  return token
}

/** 重置 token（如果以後要做切換帳號）*/
export function resetUserToken(): string {
  const token = crypto.randomUUID()
  localStorage.setItem(TOKEN_KEY, token)
  return token
}

interface FavoritesResponse {
  favorites: string[]
  count: number
}

interface ErrorResponse {
  error: string
}

function authHeader(): HeadersInit {
  return {
    Authorization: `Bearer ${getUserToken()}`,
  }
}

/** 取得最愛清單 */
export async function fetchFavorites(): Promise<string[]> {
  const r = await fetch(API_BASE, { headers: authHeader() })
  if (!r.ok) {
    throw new Error(`fetchFavorites failed: ${r.status}`)
  }
  const data = (await r.json()) as FavoritesResponse | ErrorResponse
  if ('error' in data) throw new Error(data.error)
  return data.favorites
}

/** 加進最愛 */
export async function addFavorite(stockId: string): Promise<void> {
  const r = await fetch(API_BASE, {
    method: 'POST',
    headers: { ...authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ stock_id: stockId }),
  })
  if (!r.ok) {
    const err = (await r.json()) as ErrorResponse
    throw new Error(err.error || `addFavorite failed: ${r.status}`)
  }
}

/** 從最愛移除 */
export async function removeFavorite(stockId: string): Promise<void> {
  const r = await fetch(API_BASE, {
    method: 'DELETE',
    headers: { ...authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ stock_id: stockId }),
  })
  if (!r.ok) {
    const err = (await r.json()) as ErrorResponse
    throw new Error(err.error || `removeFavorite failed: ${r.status}`)
  }
}
