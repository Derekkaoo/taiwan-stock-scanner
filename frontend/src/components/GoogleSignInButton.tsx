import { useEffect, useRef } from 'react'
import type { GoogleUser } from '../hooks/useGoogleAuth'

/**
 * GoogleSignInButton
 * - 已登入：顯示頭像 + email + 登出按鈕
 * - 未登入：渲染 Google official sign-in button（GIS 提供）
 *
 * 注意：GIS 必須在 useGoogleAuth 已 initialize 後才能 renderButton。
 */
interface Props {
  user: GoogleUser | null
  isReady: boolean
  signOut: () => void
}

export function GoogleSignInButton({ user, isReady, signOut }: Props) {
  const btnRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (user) return // 已登入不用畫 button
    if (!isReady) return
    if (!btnRef.current) return
    if (!window.google?.accounts?.id) return

    // 清空舊的（避免重渲染疊加）
    btnRef.current.innerHTML = ''
    window.google.accounts.id.renderButton(btnRef.current, {
      type: 'standard',
      theme: 'outline',
      size: 'medium',
      text: 'signin_with',
      shape: 'pill',
      logo_alignment: 'left',
    })
  }, [user, isReady])

  if (user) {
    return (
      <div className="flex items-center gap-2 text-sm">
        {user.picture && (
          <img
            src={user.picture}
            alt={user.name || user.email || 'avatar'}
            className="w-7 h-7 rounded-full border border-gray-300"
            referrerPolicy="no-referrer"
          />
        )}
        <span className="hidden sm:inline text-gray-700 truncate max-w-[160px]">
          {user.name || user.email}
        </span>
        <button
          onClick={signOut}
          className="px-2 py-1 text-xs rounded-md border border-gray-300 text-gray-600 hover:bg-gray-100 transition-colors"
          title="登出"
        >
          登出
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center">
      <div ref={btnRef} />
      {!isReady && (
        <span className="text-xs text-gray-400 ml-2">載入中...</span>
      )}
    </div>
  )
}
