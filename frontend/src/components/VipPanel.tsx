import { useState } from 'react'
import { AlertModal } from './AlertModal'
import { ENABLE_REAL_SUBSCRIBE } from '../constants/featureFlags'

/**
 * VipPanel — VIP 訂閱方案頁面（已接綠界 ECPay 信用卡定期定額）
 *
 * 用法：在 App.tsx 用 conditional render 切換主畫面 / VIP 畫面
 *   {showVip ? <VipPanel onBack={() => setShowVip(false)} /> : <主畫面 ... />}
 *
 * 設計原則：
 *   - 沿用既有深色主題（var(--color-...)）
 *   - 桌機 4 欄並排 / 手機 1 欄堆疊（CSS grid 自動 responsive）
 *   - 「立即訂閱」按鈕跳「即將開放」AlertModal（之後接 Paddle 時換 onClick 即可）
 */
interface Props {
  onBack: () => void
  idToken: string | null
  onSignIn: () => void
}

interface Plan {
  key: 'free' | 'monthly' | 'quarterly' | 'yearly'
  name: string
  price: string
  unit: string
  highlight?: string  // 「最划算」徽章
  badge?: string      // 「省 25%」之類
  features: string[]
  cta: string
  ctaDisabled?: boolean   // free 不能訂閱
  recommended?: boolean   // 季方案：邊框高亮
}

const PLANS: Plan[] = [
  {
    key: 'free',
    name: '免費版',
    price: 'NT$0',
    unit: '永久',
    features: [
      '⭐ 我的最愛 10 支',
      '📂 篩選策略 5 組',
      '🌐 跨裝置同步',
      '📈 全部圖表 + 篩選器',
    ],
    cta: '目前方案',
    ctaDisabled: true,
  },
  {
    key: 'monthly',
    name: '月付方案',
    price: 'NT$88',
    unit: '/月',
    features: [
      '⭐ 無限收藏 + 策略',
      '🔔 個人化推播',
      '🎯 個人策略命中提醒',
    ],
    cta: '立即訂閱',
  },
  {
    key: 'yearly',
    name: '年付方案',
    price: 'NT$888',
    unit: '/年',
    highlight: '⭐ 最划算',
    badge: '省 16%',
    features: [
      '⭐ 無限收藏 + 策略',
      '🔔 個人化推播',
      '🎯 個人策略命中提醒',
      '💰 平均 NT$74/月',
    ],
    cta: '立即訂閱',
    recommended: true,
  },
]

const VIP_FEATURES = [
  { icon: '🔔', title: '個人化每日推播', desc: '推送你的最愛股 + 策略命中結果' },
  { icon: '⭐', title: '無限收藏 + 策略', desc: '不受免費版 10 支收藏 / 5 組策略限制' },
  { icon: '🎯', title: '個人策略命中', desc: '你儲存的篩選策略每日自動跑，命中時 Telegram 通知' },
  { icon: '🌐', title: '跨裝置即時同步', desc: '多裝置同步收藏與策略，登入 Google 帳號即可' },
]

const FAQ = [
  { q: '可以隨時取消嗎？', a: '是的，取消後當期到期前仍享有 VIP 功能。' },
  { q: '換手機可以同步嗎？', a: '可以，登入同個 Google 帳號即可跨裝置同步收藏與策略。' },
  // 金流項目暫時隱藏 — 等綠界 ECPay 確定過審後再開
  // { q: '使用哪家金流？', a: '使用綠界 ECPay 金流，支援信用卡定期定額自動扣款、ATM 轉帳、超商繳費。' },
  { q: '推播會佔用通知空間嗎？', a: '會走 Telegram bot，可隨時關閉個別推播類型。' },
]

export function VipPanel({ onBack, idToken, onSignIn }: Props) {
  const [showSignInModal, setShowSignInModal] = useState(false)
  const [showComingSoon, setShowComingSoon] = useState(false)
  const [submitting, setSubmitting] = useState<null | 'monthly' | 'yearly'>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const onSubscribe = async (planKey: 'monthly' | 'yearly') => {
    setErrorMsg(null)
    // Feature flag: 沒開真實訂閱 → 跳「即將開放」alert（UI demo 模式）
    if (!ENABLE_REAL_SUBSCRIBE) {
      setShowComingSoon(true)
      return
    }
    if (!idToken) {
      setShowSignInModal(true)
      return
    }
    setSubmitting(planKey)
    try {
      const resp = await fetch('/api/payment/create-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ plan: planKey }),
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        setSubmitting(null)
        setErrorMsg(`建單失敗 (HTTP ${resp.status})：${data.error || JSON.stringify(data).slice(0, 200)}`)
        return
      }
      const form = document.createElement('form')
      form.method = 'POST'
      form.action = data.ecpayUrl
      form.acceptCharset = 'UTF-8'
      Object.entries(data.formFields as Record<string, unknown>).forEach(([k, v]) => {
        const input = document.createElement('input')
        input.type = 'hidden'
        input.name = k
        input.value = String(v)
        form.appendChild(input)
      })
      document.body.appendChild(form)
      form.submit()
    } catch (e) {
      setSubmitting(null)
      setErrorMsg(`網路錯誤：${e instanceof Error ? e.message : String(e)}`)
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
      {/* 頂部 header */}
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
          VIP 訂閱方案
        </h1>
      </header>

      <main className="px-4 sm:px-5 py-6 max-w-6xl mx-auto">
        {/* 標語 */}
        <div className="text-center mb-8">
          <h2
            className="text-2xl sm:text-3xl font-bold mb-2"
            style={{ color: 'var(--color-text-primary)' }}
          >
            升級 VIP，掌握每日進出時機
          </h2>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>
            個人化推播、無限收藏、個人策略命中提醒
          </p>
        </div>

        {/* 4 個方案卡片 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 16,
            marginBottom: 48,
          }}
        >
          {PLANS.map(plan => (
            <div
              key={plan.key}
              style={{
                position: 'relative',
                background: 'var(--color-bg-700)',
                border: plan.recommended
                  ? '2px solid var(--color-accent-cyan)'
                  : '1px solid var(--color-border)',
                borderRadius: 12,
                padding: '28px 20px 20px',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                minHeight: 360,
              }}
            >
              {/* 「最划算」徽章 */}
              {plan.highlight && (
                <div
                  style={{
                    position: 'absolute',
                    top: -10,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: 'var(--color-accent-cyan)',
                    color: '#fff',
                    fontSize: 11,
                    fontWeight: 700,
                    padding: '4px 10px',
                    borderRadius: 9999,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {plan.highlight}
                </div>
              )}

              {/* 方案名稱 */}
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: 'var(--color-text-secondary)',
                  textAlign: 'center',
                }}
              >
                {plan.name}
              </div>

              {/* 價格 */}
              <div style={{ textAlign: 'center', marginBottom: 4 }}>
                <span
                  style={{
                    fontSize: 28,
                    fontWeight: 700,
                    color: 'var(--color-text-primary)',
                  }}
                >
                  {plan.price}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    color: 'var(--color-text-muted)',
                    marginLeft: 4,
                  }}
                >
                  {plan.unit}
                </span>
              </div>

              {/* 省 X% 徽章 */}
              {plan.badge && (
                <div style={{ textAlign: 'center', marginTop: -6 }}>
                  <span
                    style={{
                      display: 'inline-block',
                      background: 'var(--color-up)' + '22',
                      color: 'var(--color-up)',
                      fontSize: 11,
                      fontWeight: 600,
                      padding: '3px 10px',
                      borderRadius: 9999,
                    }}
                  >
                    {plan.badge}
                  </span>
                </div>
              )}

              {/* 功能列表 */}
              <ul
                style={{
                  flex: 1,
                  listStyle: 'none',
                  padding: 0,
                  margin: '8px 0',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                {plan.features.map((f, i) => (
                  <li
                    key={i}
                    style={{
                      fontSize: 12,
                      color: 'var(--color-text-secondary)',
                      lineHeight: 1.5,
                    }}
                  >
                    {f}
                  </li>
                ))}
              </ul>

              {/* CTA 按鈕 */}
              <button
                onClick={
                  plan.ctaDisabled || submitting
                    ? undefined
                    : () => {
                        if (plan.key === 'monthly' || plan.key === 'yearly') {
                          onSubscribe(plan.key)
                        }
                      }
                }
                disabled={plan.ctaDisabled || !!submitting}
                style={{
                  width: '100%',
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: '1px solid',
                  borderColor: plan.ctaDisabled
                    ? 'var(--color-border)'
                    : 'var(--color-accent-cyan)',
                  background: plan.ctaDisabled
                    ? 'transparent'
                    : 'var(--color-accent-cyan)',
                  color: plan.ctaDisabled
                    ? 'var(--color-text-muted)'
                    : '#fff',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: plan.ctaDisabled || submitting ? 'default' : 'pointer',
                  opacity: submitting && submitting !== plan.key ? 0.5 : 1,
                }}
              >
                {submitting === plan.key ? '建單中…' : plan.cta}
              </button>
            </div>
          ))}
        </div>

        {errorMsg && (
          <div
            style={{
              maxWidth: 720,
              margin: '0 auto 24px',
              padding: '12px 16px',
              background: 'rgba(248, 81, 73, 0.1)',
              border: '1px solid rgba(248, 81, 73, 0.4)',
              borderRadius: 8,
              color: '#ffdcd7',
              fontSize: 13,
              whiteSpace: 'pre-wrap',
            }}
          >
            ⚠️ {errorMsg}
          </div>
        )}

        {/* VIP 專屬功能 */}
        <section style={{ marginBottom: 48 }}>
          <h3
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: 'var(--color-text-primary)',
              marginBottom: 20,
              textAlign: 'center',
            }}
          >
            ─── VIP 專屬功能 ───
          </h3>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: 16,
            }}
          >
            {VIP_FEATURES.map((f, i) => (
              <div
                key={i}
                style={{
                  background: 'var(--color-bg-700)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 8,
                  padding: 16,
                }}
              >
                <div style={{ fontSize: 24, marginBottom: 8 }}>{f.icon}</div>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: 'var(--color-text-primary)',
                    marginBottom: 4,
                  }}
                >
                  {f.title}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--color-text-muted)',
                    lineHeight: 1.5,
                  }}
                >
                  {f.desc}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section style={{ marginBottom: 48 }}>
          <h3
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: 'var(--color-text-primary)',
              marginBottom: 20,
              textAlign: 'center',
            }}
          >
            ─── 常見問題 ───
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {FAQ.map((item, i) => (
              <details
                key={i}
                style={{
                  background: 'var(--color-bg-700)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 8,
                  padding: '12px 16px',
                }}
              >
                <summary
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--color-text-primary)',
                    cursor: 'pointer',
                  }}
                >
                  {item.q}
                </summary>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--color-text-secondary)',
                    marginTop: 8,
                    lineHeight: 1.6,
                  }}
                >
                  {item.a}
                </div>
              </details>
            ))}
          </div>
        </section>

        {/* 底部小字 */}
        <div
          style={{
            textAlign: 'center',
            fontSize: 11,
            color: 'var(--color-text-muted)',
            paddingBottom: 32,
          }}
        >
          訂閱即代表同意服務條款。可隨時取消。
        </div>
      </main>

      {/* 「即將開放」modal（feature flag 關閉時用）*/}
      <AlertModal
        open={showComingSoon}
        onClose={() => setShowComingSoon(false)}
        icon="crown"
        title="VIP 訂閱即將開放"
        message={
          <>
            目前為試用階段，所有功能免費開放使用 ✨
            <br />
            VIP 訂閱即將開放，敬請期待。
          </>
        }
        primary={{
          label: '知道了',
          onClick: () => setShowComingSoon(false),
        }}
      />

      {/* 未登入提示 modal */}
      <AlertModal
        open={showSignInModal}
        onClose={() => setShowSignInModal(false)}
        icon="crown"
        title="請先登入 Google"
        message={
          <>
            訂閱 VIP 需要 Google 帳號登入，
            <br />
            這樣你的 VIP 狀態才會跟著帳號跨裝置同步。
          </>
        }
        primary={{
          label: '登入 Google',
          onClick: () => {
            setShowSignInModal(false)
            onSignIn()
          },
        }}
        secondary={{
          label: '取消',
          onClick: () => setShowSignInModal(false),
        }}
      />
    </div>
  )
}
