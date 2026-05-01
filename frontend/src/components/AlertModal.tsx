import { useEffect } from 'react'

/**
 * 通用提示型 modal — 不同於確認對話框，這是給「請先登入 / 已達上限」這類訊息用
 *
 * 設計：
 *   - 中央彈窗 + 背景 dim
 *   - 圖示 + 標題 + 訊息文字
 *   - 一個 primary 按鈕（預設「我知道了」），可選 secondary
 *   - ESC 關閉、點背景關閉
 */
interface Action {
  label: string
  onClick: () => void
  variant?: 'primary' | 'ghost'
}

interface Props {
  open: boolean
  onClose: () => void
  icon?: 'login' | 'lock' | 'info' | 'crown'
  title: string
  message: React.ReactNode
  primary?: Action
  secondary?: Action
}

const ICONS: Record<NonNullable<Props['icon']>, string> = {
  login: '🔐',
  lock: '🔒',
  info: 'ℹ️',
  crown: '👑',
}

export function AlertModal({
  open, onClose, icon = 'info', title, message, primary, secondary,
}: Props) {
  // ESC 關閉
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // body scroll lock
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  if (!open) return null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background: 'rgba(0, 0, 0, 0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 380,
          background: 'var(--color-bg-700)',
          border: '1px solid var(--color-border)',
          borderRadius: 12,
          padding: '24px 20px 20px',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
          color: 'var(--color-text-primary)',
        }}
      >
        <div style={{ fontSize: 36, textAlign: 'center', marginBottom: 12 }}>
          {ICONS[icon]}
        </div>
        <div
          style={{
            fontSize: 16,
            fontWeight: 700,
            textAlign: 'center',
            marginBottom: 8,
            color: 'var(--color-text-primary)',
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: 13,
            textAlign: 'center',
            lineHeight: 1.6,
            color: 'var(--color-text-secondary)',
            marginBottom: 20,
          }}
        >
          {message}
        </div>
        <div
          style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'center',
            flexDirection: 'column',
          }}
        >
          {primary && (
            <button
              onClick={primary.onClick}
              style={{
                width: '100%',
                padding: '10px 16px',
                borderRadius: 8,
                border: '1px solid var(--color-accent-cyan)',
                background: 'var(--color-accent-cyan)',
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {primary.label}
            </button>
          )}
          {secondary && (
            <button
              onClick={secondary.onClick}
              style={{
                width: '100%',
                padding: '10px 16px',
                borderRadius: 8,
                border: '1px solid var(--color-border)',
                background: 'transparent',
                color: 'var(--color-text-secondary)',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              {secondary.label}
            </button>
          )}
          {!primary && !secondary && (
            <button
              onClick={onClose}
              style={{
                width: '100%',
                padding: '10px 16px',
                borderRadius: 8,
                border: '1px solid var(--color-accent-cyan)',
                background: 'var(--color-accent-cyan)',
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              我知道了
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
