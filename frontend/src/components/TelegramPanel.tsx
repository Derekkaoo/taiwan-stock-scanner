import { useState, useEffect } from 'react'
import { useTelegramBinding } from '../hooks/useTelegramBinding'
import type { BindCodeResponse } from '../api/telegram'

/**
 * TelegramPanel — Telegram 推播綁定面板
 *
 * 流程：
 *   未綁定 →「綁定 Telegram」按鈕
 *           → 點擊 → POST /api/telegram/bind-code → 開 modal
 *           → modal 顯示 code + 「開啟 Telegram」deeplink (https://t.me/<bot>?start=<code>)
 *           → 同時 hook 自動每 3 秒輪詢 GET /api/telegram/binding
 *           → 偵測 bound:true → hook 自動關 modal + 顯示「已綁定」
 *
 *   已綁定 → 顯示綁定資訊 + 「解除綁定」按鈕
 *
 * 未登入時 return null（跟 StrategyManager 一致）
 */

interface Props {
  idToken: string | null
}

const styles = {
  primaryBtn: {
    background: 'var(--color-accent-cyan)',
    borderColor: 'var(--color-accent-cyan)',
    color: '#fff',
  } as React.CSSProperties,
  ghostBtn: {
    background: 'var(--color-bg-600)',
    borderColor: 'var(--color-border)',
    color: 'var(--color-text-secondary)',
  } as React.CSSProperties,
  dangerBtn: {
    background: 'var(--color-bg-600)',
    borderColor: 'var(--color-accent-red)' + '66',
    color: 'var(--color-accent-red)',
  } as React.CSSProperties,
  pillBound: {
    background: 'var(--color-bg-600)',
    border: '1px solid var(--color-accent-green)' + '66',
    color: 'var(--color-accent-green)',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 11,
  } as React.CSSProperties,
  pillUnbound: {
    background: 'var(--color-bg-600)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text-muted)',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 11,
  } as React.CSSProperties,
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

export function TelegramPanel({ idToken }: Props) {
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

  if (!idToken) return null

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
    <>
      <div className="flex flex-wrap items-center gap-2" style={{ fontSize: 12 }}>
        <span style={{ color: 'var(--color-text-muted)' }}>Telegram 推播：</span>

        {loading ? (
          <span style={styles.pillUnbound}>讀取中…</span>
        ) : binding.bound ? (
          <>
            <span style={styles.pillBound} title="已綁定，每平日 19:00 自動推播">
              ✅ {fmtBoundDisplay(binding)}
            </span>
            <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>
              上次推播 {fmtUnixDate(binding.last_push_at)}
            </span>
            <button
              onClick={onUnbindClick}
              disabled={busy}
              className="px-2 py-1 rounded border transition-colors disabled:opacity-50"
              style={styles.dangerBtn}
            >
              解除綁定
            </button>
          </>
        ) : (
          <>
            <span style={styles.pillUnbound}>未綁定</span>
            <button
              onClick={onBindClick}
              disabled={busy}
              className="px-2 py-1 rounded border transition-colors disabled:opacity-50"
              style={styles.primaryBtn}
              title="綁定後每平日 19:00 自動推播選股結果"
            >
              {busy ? '產生中…' : '綁定 Telegram'}
            </button>
          </>
        )}

        {error && (
          <span style={{ color: 'var(--color-accent-red)', fontSize: 11 }} title={error}>
            ⚠ {error.length > 30 ? error.slice(0, 30) + '...' : error}
          </span>
        )}
      </div>

      {bindCode && (
        <BindModal
          code={bindCode}
          pollingActive={pollingActive}
          onCancel={cancelPolling}
        />
      )}
    </>
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

  // 1 秒一次更新「剩餘時間」顯示
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
      // 不能 clipboard 就略過
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

        {/* 綁定碼顯示 */}
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

        {/* 開啟 Telegram 主要 CTA */}
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

        {/* 狀態 + 倒數 */}
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
            style={styles.ghostBtn}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  )
}
