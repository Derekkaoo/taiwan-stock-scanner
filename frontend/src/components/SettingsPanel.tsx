import { useState, useEffect } from 'react'
import { useTelegramBinding } from '../hooks/useTelegramBinding'
import type { BindCodeResponse } from '../api/telegram'
import { SHOW_VIP_UI } from '../constants/featureFlags'

/**
 * SettingsPanel — 推播設定全頁
 *
 * 用法：在 App.tsx 用 conditional render，跟 VipPanel 同樣模式
 *   {showSettings ? <SettingsPanel onBack={...} idToken={...} onShowVip={...} /> : <主畫面 />}
 *
 * 三張卡片：
 *   1. VIP 狀態 — 目前先 placeholder（未接 backend tier API）
 *   2. 通知頻道 — Telegram 行（綁定/解除綁定）
 *   3. 通知類型 — disabled placeholder（之後做後端設定才能開）
 */

interface Props {
  onBack: () => void
  onShowVip: () => void
  idToken: string | null
}

const cardStyle: React.CSSProperties = {
  background: 'var(--color-bg-700)',
  border: '1px solid var(--color-border)',
  borderRadius: 12,
  padding: '20px 24px',
  marginBottom: 16,
}

const cardTitleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--color-text-primary)',
  marginBottom: 16,
  paddingBottom: 12,
  borderBottom: '1px solid var(--color-border)',
}

const channelRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  padding: '12px 0',
}

const iconBoxStyle = (bg: string): React.CSSProperties => ({
  width: 40,
  height: 40,
  borderRadius: 8,
  background: bg,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  fontWeight: 700,
  color: '#fff',
  fontSize: 12,
})

const primaryBtnStyle: React.CSSProperties = {
  background: 'var(--color-accent-cyan)',
  borderColor: 'var(--color-accent-cyan)',
  color: '#fff',
  fontSize: 12,
  padding: '6px 14px',
}

const dangerBtnStyle: React.CSSProperties = {
  background: 'var(--color-bg-600)',
  borderColor: 'var(--color-accent-red)' + '66',
  color: 'var(--color-accent-red)',
  fontSize: 12,
  padding: '6px 14px',
}

const ghostBtnStyle: React.CSSProperties = {
  background: 'var(--color-bg-600)',
  borderColor: 'var(--color-border)',
  color: 'var(--color-text-secondary)',
  fontSize: 12,
  padding: '6px 14px',
}

function fmtBoundDisplay(b: { username?: string | null; first_name?: string | null }): string {
  if (b.username) return `@${b.username}`
  if (b.first_name) return b.first_name
  return '已綁定'
}

function fmtUnixDate(unixSec: number | null | undefined): string {
  if (!unixSec) return '尚未推播'
  return new Date(unixSec * 1000).toISOString().slice(0, 10)
}

export function SettingsPanel({ onBack, onShowVip, idToken }: Props) {
  const {
    binding,
    loading,
    error,
    bindCode,
    pollingActive,
    generateCode,
    cancelPolling,
    unbind,
  } = useTelegramBinding(idToken)

  const [busy, setBusy] = useState(false)

  const onBindClick = async () => {
    setBusy(true)
    try {
      await generateCode()
    } finally {
      setBusy(false)
    }
  }

  const onUnbindClick = async () => {
    if (!confirm('確定要解除 Telegram 綁定？解除後將不再收到每日推播。')) return
    setBusy(true)
    try {
      await unbind()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--color-bg-800)',
        color: 'var(--color-text-primary)',
      }}
    >
      <header
        className="sticky top-0 z-50 flex items-center gap-4 px-5 py-3 border-b"
        style={{
          background: 'var(--color-bg-700)',
          borderColor: 'var(--color-border)',
        }}
      >
        <button
          onClick={onBack}
          className="px-3 py-1 rounded border transition-colors"
          style={{
            background: 'var(--color-bg-600)',
            borderColor: 'var(--color-border)',
            color: 'var(--color-text-secondary)',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          ← 返回
        </button>
        <h1
          className="text-base font-bold"
          style={{ color: 'var(--color-accent-cyan)', letterSpacing: '0.5px' }}
        >
          推播設定
        </h1>
      </header>

      <main className="px-4 sm:px-5 py-6" style={{ maxWidth: 720, margin: '0 auto' }}>
        {/* === 帳號狀態 ===
          試用期版本：顯示「✨ 試用中」+ 額度資訊，不出現 VIP 升級按鈕。
          Lemon Squeezy 過件後 SHOW_VIP_UI=true → 切回 VIP 升級流程 */}
        {SHOW_VIP_UI ? (
          <div style={cardStyle}>
            <div style={cardTitleStyle}>VIP 狀態</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div
                style={{
                  padding: '4px 12px',
                  borderRadius: 6,
                  background: 'var(--color-text-muted)' + '22',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-secondary)',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                FREE
              </div>
              <span style={{ color: 'var(--color-text-secondary)', fontSize: 13, flex: 1 }}>
                免費版（基本功能 + 5 組策略）
              </span>
              <button
                onClick={onShowVip}
                className="rounded border transition-colors"
                style={primaryBtnStyle}
              >
                升級 VIP
              </button>
            </div>
          </div>
        ) : (
          <div style={cardStyle}>
            <div style={cardTitleStyle}>帳號狀態</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div
                style={{
                  padding: '4px 12px',
                  borderRadius: 6,
                  background: 'rgba(6, 182, 212, 0.18)',
                  border: '1px solid var(--color-accent-cyan)',
                  color: 'var(--color-accent-cyan)',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                ✨ 試用中
              </div>
              <span style={{ color: 'var(--color-text-secondary)', fontSize: 13, flex: 1 }}>
                可使用進階功能：Telegram 每日策略通知
              </span>
            </div>
          </div>
        )}

        {/* === 通知頻道 === */}
        <div style={cardStyle}>
          <div style={cardTitleStyle}>通知頻道</div>

          {/* Telegram 行 */}
          <div style={channelRowStyle}>
            <div style={iconBoxStyle('#229ED9')}>TG</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                Telegram
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                {loading ? (
                  '讀取中…'
                ) : binding.bound ? (
                  <>
                    <span style={{ color: 'var(--color-accent-green)' }}>
                      ✅ 已綁定 {fmtBoundDisplay(binding)}
                    </span>
                    <span style={{ color: 'var(--color-text-muted)', marginLeft: 8 }}>
                      上次推播 {fmtUnixDate(binding.last_push_at)}
                    </span>
                  </>
                ) : (
                  <span style={{ color: 'var(--color-text-muted)' }}>未綁定</span>
                )}
              </div>
            </div>
            {binding.bound ? (
              <button
                onClick={onUnbindClick}
                disabled={busy}
                className="rounded border transition-colors disabled:opacity-50"
                style={dangerBtnStyle}
              >
                解除綁定
              </button>
            ) : (
              <button
                onClick={onBindClick}
                disabled={busy}
                className="rounded border transition-colors disabled:opacity-50"
                style={primaryBtnStyle}
              >
                {busy ? '產生中…' : '綁定'}
              </button>
            )}
          </div>

          {error && (
            <div style={{ color: 'var(--color-accent-red)', fontSize: 11, marginTop: 8 }}>
              ⚠ {error}
            </div>
          )}

          <div
            style={{
              marginTop: 12,
              fontSize: 11,
              color: 'var(--color-text-muted)',
              padding: '8px 12px',
              background: 'var(--color-bg-600)',
              borderRadius: 6,
              border: '1px dashed var(--color-border)',
            }}
          >
            💡 綁定後，每平日 19:00 自動推播你的選股策略命中結果到 Telegram。
          </div>
        </div>

        {/* === 通知類型 === */}
        <div style={cardStyle}>
          <div style={cardTitleStyle}>通知類型</div>

          <NotifyTypeRow
            label="每日選股推播（平日 19:00）"
            checked={true}
            disabled={true}
            hint="預設開啟。所有已綁定的策略命中結果會合併成一則訊息推播。"
          />
        </div>
      </main>

      {bindCode && (
        <BindModal
          code={bindCode}
          pollingActive={pollingActive}
          onCancel={cancelPolling}
        />
      )}
    </div>
  )
}

interface NotifyTypeRowProps {
  label: string
  checked: boolean
  disabled?: boolean
  hint?: string
}

function NotifyTypeRow({ label, checked, disabled, hint }: NotifyTypeRowProps) {
  return (
    <div style={{ padding: '10px 0', borderBottom: '1px solid var(--color-border)' }}>
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.7 : 1,
        }}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          readOnly
          style={{ accentColor: 'var(--color-accent-cyan)' }}
        />
        <span style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>{label}</span>
        {disabled && (
          <span
            style={{
              fontSize: 10,
              color: 'var(--color-text-muted)',
              padding: '1px 6px',
              borderRadius: 4,
              border: '1px solid var(--color-border)',
            }}
          >
            預設
          </span>
        )}
      </label>
      {hint && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--color-text-muted)',
            marginTop: 4,
            marginLeft: 24,
          }}
        >
          {hint}
        </div>
      )}
    </div>
  )
}

interface BindModalProps {
  code: BindCodeResponse
  pollingActive: boolean
  onCancel: () => void
}

function BindModal({ code, pollingActive, onCancel }: BindModalProps) {
  const [now, setNow] = useState(() => Date.now())
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])

  const remainingMs = Math.max(0, code.expires_at - now)
  const remainingMin = Math.floor(remainingMs / 60000)
  const remainingSec = Math.floor((remainingMs % 60000) / 1000)
  const expired = remainingMs <= 0

  const elapsedSinceOpenSec = Math.floor((now - (code.expires_at - 10 * 60 * 1000)) / 1000)
  const longWait = elapsedSinceOpenSec > 30

  const deeplink = `https://t.me/${code.bot_username}?start=${code.code}`

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code.code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* 忽略 */
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="rounded-lg border shadow-xl"
        style={{
          background: 'var(--color-bg-700)',
          borderColor: 'var(--color-border)',
          color: 'var(--color-text-primary)',
          maxWidth: 420,
          width: '100%',
          padding: 20,
        }}
      >
        <h3
          style={{
            fontSize: 16,
            fontWeight: 600,
            marginBottom: 12,
            color: 'var(--color-text-primary)',
          }}
        >
          綁定 Telegram
        </h3>

        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 12 }}>
          點下方按鈕會跳到 Telegram，按下「Start」即完成綁定。
          <br />
          也可以手動把綁定碼貼到 <code>@{code.bot_username}</code> 對話：
        </p>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 14,
            padding: '10px 12px',
            background: 'var(--color-bg-600)',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
          }}
        >
          <span
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 22,
              letterSpacing: 4,
              fontWeight: 600,
              color: 'var(--color-accent-cyan)',
              flex: 1,
              textAlign: 'center',
            }}
          >
            {code.code}
          </span>
          <button
            onClick={handleCopy}
            className="px-2 py-1 rounded border transition-colors"
            style={{
              background: 'var(--color-bg-700)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text-secondary)',
              fontSize: 11,
            }}
          >
            {copied ? '已複製' : '複製'}
          </button>
        </div>

        {/* 安裝提示 + 下載連結 */}
        <div
          style={{
            padding: '8px 10px',
            background: 'var(--color-bg-600)',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            marginBottom: 10,
            fontSize: 11,
            color: 'var(--color-text-secondary)',
          }}
        >
          <div style={{ marginBottom: 6 }}>
            ⚠️ 請先安裝 <b>Telegram 桌面版或手機 App</b>（網頁版按 Start 常常沒反應）。
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <a
              href="https://desktop.telegram.org/"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--color-accent-cyan)', textDecoration: 'underline' }}
            >
              桌面版
            </a>
            <span style={{ color: 'var(--color-text-muted)' }}>·</span>
            <a
              href="https://apps.apple.com/app/telegram-messenger/id686449807"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--color-accent-cyan)', textDecoration: 'underline' }}
            >
              iOS
            </a>
            <span style={{ color: 'var(--color-text-muted)' }}>·</span>
            <a
              href="https://play.google.com/store/apps/details?id=org.telegram.messenger"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--color-accent-cyan)', textDecoration: 'underline' }}
            >
              Android
            </a>
          </div>
        </div>

        <a
          href={deeplink}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full text-center px-3 py-2 rounded border transition-colors"
          style={{
            background: 'var(--color-accent-cyan)',
            borderColor: 'var(--color-accent-cyan)',
            color: '#fff',
            fontWeight: 500,
            textDecoration: 'none',
            marginBottom: 12,
          }}
        >
          📱 開啟 Telegram 完成綁定
        </a>

        <div
          style={{
            fontSize: 11,
            color: 'var(--color-text-muted)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 14,
          }}
        >
          <span>
            {expired ? (
              <span style={{ color: 'var(--color-accent-red)' }}>⏱ 綁定碼已過期，請取消重試</span>
            ) : pollingActive ? (
              <span>
                <span style={{ display: 'inline-block', marginRight: 4 }} className="animate-pulse">
                  ⏳
                </span>
                等待綁定中…
                {longWait && (
                  <span style={{ display: 'block', marginTop: 2 }}>
                    （已 {elapsedSinceOpenSec}s 未偵測到，請確認已在 Telegram 按 Start）
                  </span>
                )}
              </span>
            ) : (
              <span>已停止輪詢</span>
            )}
          </span>
          {!expired && (
            <span style={{ fontFamily: 'ui-monospace, monospace' }}>
              {String(remainingMin).padStart(2, '0')}:{String(remainingSec).padStart(2, '0')}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded border transition-colors"
            style={ghostBtnStyle}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  )
}
