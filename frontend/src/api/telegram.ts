/**
 * Telegram API client — 跟 /api/telegram/* 串接
 * 認證用 Google ID Token（caller 提供）
 */

const API_BASE = '/api/telegram'

export interface BindCodeResponse {
  code: string
  /** Unix milliseconds */
  expires_at: number
  bot_username: string
}

export interface BindingInfo {
  bound: boolean
  username?: string | null
  first_name?: string | null
  /** Unix seconds */
  bound_at?: number
  /** Unix seconds */
  last_push_at?: number | null
  last_push_status?: string | null
}

interface ErrorResponse {
  error: string
}

function authHeader(idToken: string): HeadersInit {
  return { Authorization: `Bearer ${idToken}` }
}

async function parseOrThrow<T>(r: Response): Promise<T> {
  let data: T | ErrorResponse
  try {
    data = (await r.json()) as T | ErrorResponse
  } catch {
    throw new Error(`HTTP ${r.status}`)
  }
  if (!r.ok) {
    const msg = (data as ErrorResponse).error || `HTTP ${r.status}`
    throw new Error(msg)
  }
  if (data && typeof data === 'object' && 'error' in (data as object)) {
    throw new Error((data as ErrorResponse).error)
  }
  return data as T
}

/** 產生 6 位英數綁定碼（10 分鐘 TTL） */
export async function createBindCode(idToken: string): Promise<BindCodeResponse> {
  const r = await fetch(`${API_BASE}/bind-code`, {
    method: 'POST',
    headers: authHeader(idToken),
  })
  return parseOrThrow<BindCodeResponse>(r)
}

/** 查當前 user 的 Telegram 綁定狀態 */
export async function getBinding(idToken: string): Promise<BindingInfo> {
  const r = await fetch(`${API_BASE}/binding`, {
    headers: authHeader(idToken),
  })
  return parseOrThrow<BindingInfo>(r)
}

/** 解除綁定 */
export async function deleteBinding(idToken: string): Promise<void> {
  const r = await fetch(`${API_BASE}/binding`, {
    method: 'DELETE',
    headers: authHeader(idToken),
  })
  await parseOrThrow<{ deleted: true }>(r)
}
