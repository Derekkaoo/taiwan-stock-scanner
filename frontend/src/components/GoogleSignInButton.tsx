import { useEffect, useRef, useState } from 'react'
import type { GoogleUser } from '../hooks/useGoogleAuth'

/**
 * GoogleSignInButton
 *
 * 已登入：頭像 + 名字 + 登出
 * 未登入：自訂 dark-themed 按鈕（跟整個 app 配色一致）
 *   底層仍用 Google GIS 官方 renderButton（隱藏在 absolute 框內）
 *   我們的按鈕點下去會程式呼叫 hidden 那顆的 click，
 *   因此符合 Google 的 GIS guideline（按鈕功能未被取代，只是 UI 換皮）
 */
interface Props {
  user: GoogleUser | null
  isReady: boolean
  signOut: () => void
}

export function GoogleSignInButton({ user, isReady, signOut }: Props) {
  const hiddenBtnRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState(false)

  // 渲染隱藏的 Google 官方按鈕 (即使視覺隱藏，仍是 functional click target)
  useEffect(() => {
    if (user) return
    if (!isReady) return
    if (!hiddenBtnRef.current) return
    if (!window.google?.accounts?.id) return

    hiddenBtnRef.current.innerHTML = ''
    window.google.accounts.id.renderButton(hiddenBtnRef.current, {
      type: 'standard',
      theme: 'filled_black',
      size: 'large',
      text: 'signin_with',
      shape: 'rectangular',
      logo_alignment: 'left',
      width: 240,
    })
  }, [user, isReady])

  const triggerGoogleClick = () => {
    if (!hiddenBtnRef.current) return
    // GIS 渲染後 DOM 結構：div > div[role="button"]
    const realBtn =
      hiddenBtnRef.current.querySelector<HTMLElement>('div[role="button"]') ||
      hiddenBtnRef.current.querySelector<HTMLElement>('button') ||
      (hiddenBtnRef.current.firstElementChild as HTMLElement | null)
    realBtn?.click()
  }

  if (user) {
    return (
      <div className="flex items-center gap-2 text-xs">
        {user.picture ? (
          <img
            src={user.picture}
            alt={user.name || user.email || 'avatar'}
            className="w-6 h-6 rounded-full"
            style={{ border: '1px solid var(--color-border)' }}
            referrerPolicy="no-referrer"
          />
        ) : (
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
            style={{
              background: 'var(--color-accent-cyan)',
              color: '#fff',
            }}
          >
            {(user.name || user.email || '?').slice(0, 1).toUpperCase()}
          </div>
        )}
        <span
          className="hidden sm:inline truncate max-w-[140px]"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {user.name || user.email}
        </span>
        <button
          onClick={signOut}
          className="px-2 py-0.5 rounded border transition-colors"
          style={{
            background: 'var(--color-bg-600)',
            borderColor: 'var(--color-border)',
            color: 'var(--color-text-muted)',
            fontSize: 11,
            cursor: 'pointer',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.color = 'var(--color-accent-red)'
            e.currentTarget.style.borderColor = 'var(--color-accent-red)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.color = 'var(--color-text-muted)'
            e.currentTarget.style.borderColor = 'var(--color-border)'
          }}
          title="登出"
        >
          登出
        </button>
      </div>
    )
  }

  // 未登入：自訂按鈕 + 隱藏 Google 真按鈕
  return (
    <div className="relative">
      {/* 真正的 Google 按鈕，視覺隱藏但 click 可達 */}
      <div
        ref={hiddenBtnRef}
        style={{
          position: 'absolute',
          opacity: 0,
          pointerEvents: 'none',
          width: 1,
          height: 1,
          overflow: 'hidden',
        }}
        aria-hidden="true"
      />
      {/* 我們自己的漂亮按鈕 */}
      <button
        type="button"
        onClick={triggerGoogleClick}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        disabled={!isReady}
        className="flex items-center gap-2 px-3 py-1 rounded-md border transition-all"
        style={{
          background: hover ? 'var(--color-bg-600)' : 'transparent',
          borderColor: hover ? 'var(--color-accent-cyan)' : 'var(--color-border)',
          color: 'var(--color-text-secondary)',
          fontSize: 12,
          fontWeight: 500,
          cursor: isReady ? 'pointer' : 'not-allowed',
          opacity: isReady ? 1 : 0.5,
        }}
      >
        {/* Google G logo (官方多色版 SVG) */}
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          />
        </svg>
        <span>{isReady ? '使用 Google 登入' : '載入中…'}</span>
      </button>
    </div>
  )
}
