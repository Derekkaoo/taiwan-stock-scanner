/**
 * Favorites API client
 * 跟 Cloudflare Pages Functions 的 /api/favorites 串接
 */

const API_BASE = '/api/favorites'

const TOKEN_KEY = 'stock-scanner-user-token'

/**
 * UUID 產生器
 * crypto.randomUUID() 只在 secure context (HTTPS / localhost) 可用，
 * 手機透過 LAN IP (HTTP) 訪問時會炸 → 用純 JS fallback。
 */
function generateUUID(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    // ignore
  }
  // RFC 4122 v4 fallback（純 Math.random，user identifier 強度夠用）
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/** 取得使用者 token；第一次訪問自動生成 UUID 存 localStorage */
export function getUserToken(): string {
  let token = localStorage.getItem(TOKEN_KEY)
  if (!token) {
    token = generateUUID()
    localStorage.setItem(TOKEN_KEY, token)
  }
  return token
}

/** 重置 token（如果以後要做切換帳號）*/
export function resetUserToken(): string {
  const token = generateUUID()
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

/**
 * 認證 header：登入 Google → 帶 ID Token；未登入 → 帶 UUID
 * 後端會自動偵測 JWT vs UUID 並用對應 user_token
 */
function authHeader(idToken: string | null): HeadersInit {
  const bearer = idToken || getUserToken()
  return { Authorization: `Bearer ${bearer}` }
}

/** 取得最愛清單 */
export async function fetchFavorites(idToken: string | null): Promise<string[]> {
  const r = await fetch(API_BASE, { headers: authHeader(idToken) })
  if (!r.ok) {
    throw new Error(`fetchFavorites failed: ${r.status}`)
  }
  const data = (await r.json()) as FavoritesResponse | ErrorResponse
  if ('error' in data) throw new Error(data.error)
  return data.favorites
}

/** 加進最愛 */
export async function addFavorite(stockId: string, idToken: string | null): Promise<void> {
  const r = await fetch(API_BASE, {
    method: 'POST',
    headers: { ...authHeader(idToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ stock_id: stockId }),
  })
  if (!r.ok) {
    const err = (await r.json()) as ErrorResponse
    throw new Error(err.error || `addFavorite failed: ${r.status}`)
  }
}

/** 從最愛移除 */
export async function removeFavorite(stockId: string, idToken: string | null): Promise<void> {
  const r = await fetch(API_BASE, {
    method: 'DELETE',
    headers: { ...authHeader(idToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ stock_id: stockId }),
  })
  if (!r.ok) {
    const err = (await r.json()) as ErrorResponse
    throw new Error(err.error || `removeFavorite failed: ${r.status}`)
  }
}
