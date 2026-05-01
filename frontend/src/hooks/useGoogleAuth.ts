import { useEffect, useState, useCallback, useRef } from 'react'

/**
 * useGoogleAuth — Google Identity Services (GIS) 整合 hook
 *
 * 流程：
 *   1. 載入 GIS SDK（已在 index.html script 載入）
 *   2. 呼叫 google.accounts.id.initialize 設 callback
 *   3. 使用者點 sign-in button → callback 收到 ID Token
 *   4. 我們把 ID Token 存 localStorage 當 session
 *   5. ID Token 有效期 1 小時，過期就要重新登入（這裡會在過期 5 分鐘前主動清掉）
 *
 * 提供：
 *   - user: 解出來的 payload（含 email/name/picture/sub）
 *   - idToken: 當下的 ID Token，要拿去打 API
 *   - signOut(): 清 token + 通知 GIS disable auto-select
 *   - isReady: GIS SDK 已載入完
 *
 * 注意：renderButton 不在這個 hook 內，由 <GoogleSignInButton /> 元件負責呼叫。
 */

const TOKEN_KEY = 'stock-scanner-google-id-token'

export interface GoogleUser {
  sub: string
  email?: string
  email_verified?: boolean
  name?: string
  picture?: string
  given_name?: string
  family_name?: string
  iat: number
  exp: number
}

interface CredentialResponse {
  credential: string
  select_by?: string
}

interface GoogleIdConfig {
  client_id: string
  callback: (response: CredentialResponse) => void
  auto_select?: boolean
  cancel_on_tap_outside?: boolean
}

interface GoogleIdRenderButtonOpts {
  type?: 'standard' | 'icon'
  theme?: 'outline' | 'filled_blue' | 'filled_black'
  size?: 'large' | 'medium' | 'small'
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin'
  shape?: 'rectangular' | 'pill' | 'circle' | 'square'
  logo_alignment?: 'left' | 'center'
  width?: number | string
  locale?: string
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: GoogleIdConfig) => void
          renderButton: (parent: HTMLElement, opts: GoogleIdRenderButtonOpts) => void
          prompt: () => void
          disableAutoSelect: () => void
        }
      }
    }
    __googleAuthInitialized?: boolean
    __googleAuthCallback?: (resp: CredentialResponse) => void
  }
}

// Base64URL → string (UTF-8) — 跟 backend 同一套
function base64UrlDecodeToString(s: string): string {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = padded.length % 4
  const b64 = pad ? padded + '='.repeat(4 - pad) : padded
  const bin = atob(b64)
  // 處理 UTF-8
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

function decodeJwtPayload(jwt: string): GoogleUser | null {
  try {
    const parts = jwt.split('.')
    if (parts.length !== 3) return null
    return JSON.parse(base64UrlDecodeToString(parts[1])) as GoogleUser
  } catch {
    return null
  }
}

function isExpired(user: GoogleUser | null, marginSec = 0): boolean {
  if (!user) return true
  const nowSec = Math.floor(Date.now() / 1000)
  return user.exp <= nowSec + marginSec
}

interface UseGoogleAuthOptions {
  clientId: string
}

export function useGoogleAuth({ clientId }: UseGoogleAuthOptions) {
  const [idToken, setIdToken] = useState<string | null>(() => {
    const t = localStorage.getItem(TOKEN_KEY)
    if (!t) return null
    const u = decodeJwtPayload(t)
    if (!u || isExpired(u)) {
      localStorage.removeItem(TOKEN_KEY)
      return null
    }
    return t
  })
  const [isReady, setIsReady] = useState(false)
  const initializedRef = useRef(false)

  const user: GoogleUser | null = idToken ? decodeJwtPayload(idToken) : null

  // GIS callback：收到新 ID Token → 存起來
  const handleCredential = useCallback((resp: CredentialResponse) => {
    if (!resp.credential) return
    const u = decodeJwtPayload(resp.credential)
    if (!u || isExpired(u)) return
    localStorage.setItem(TOKEN_KEY, resp.credential)
    setIdToken(resp.credential)
  }, [])

  // 等 GIS SDK 載入 → initialize
  useEffect(() => {
    if (!clientId) return
    if (initializedRef.current) return

    let cancelled = false
    const tryInit = () => {
      if (cancelled) return
      if (window.google?.accounts?.id) {
        if (!window.__googleAuthInitialized) {
          window.google.accounts.id.initialize({
            client_id: clientId,
            callback: (resp) => window.__googleAuthCallback?.(resp),
            auto_select: false,
            cancel_on_tap_outside: true,
          })
          window.__googleAuthInitialized = true
        }
        // 註冊 / 更新 callback（即使 SDK 只 initialize 一次，每個 hook instance 還是要能收）
        window.__googleAuthCallback = handleCredential
        initializedRef.current = true
        setIsReady(true)
      } else {
        setTimeout(tryInit, 100)
      }
    }
    tryInit()
    return () => {
      cancelled = true
    }
  }, [clientId, handleCredential])

  // 過期自動登出檢查（每分鐘）
  useEffect(() => {
    if (!idToken) return
    const u = decodeJwtPayload(idToken)
    if (!u) return

    const tick = () => {
      if (isExpired(u, 60)) {
        // 1 分鐘內就會過期 → 清掉
        localStorage.removeItem(TOKEN_KEY)
        setIdToken(null)
      }
    }
    tick()
    const t = setInterval(tick, 60 * 1000)
    return () => clearInterval(t)
  }, [idToken])

  const signOut = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    setIdToken(null)
    try {
      window.google?.accounts.id.disableAutoSelect()
    } catch {
      // ignore
    }
  }, [])

  return {
    user,
    idToken,
    isSignedIn: !!user,
    isReady,
    signOut,
  }
}
