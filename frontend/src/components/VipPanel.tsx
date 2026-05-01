import { useState } from 'react'
import { AlertModal } from './AlertModal'

/**
 * VipPanel — VIP 訂閱方案頁面（mockup，不接金流）
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
    price: 'NT$128',
    unit: '/月',
    features: [
      '⭐ 無限收藏 + 策略',
      '🔔 個人化推播',
      '📊 大戶異動即時通知',
      '🎯 個人策略命中提醒',
    ],
    cta: '立即訂閱',
  },
  {
    key: 'quarterly',
    name: '季付方案',
    price: 'NT$288',
    unit: '/季',
    highlight: '⭐ 最划算',
    badge: '省 25%',
    features: [
      '⭐ 無限收藏 + 策略',
      '🔔 個人化推播',
      '📊 大戶異動即時通知',
      '🎯 個人策略命中提醒',
      '💰 平均 NT$96/月',
    ],
    cta: '立即訂閱',
    recommended: true,
  },
  {
    key: 'yearly',
    name: '年付方案',
    price: 'NT$888',
    unit: '/年',
    badge: '省 42%',
    features: [
      '⭐ 無限收藏 + 策略',
      '🔔 個人化推播',
      '📊 大戶異動即時通知',
      '🎯 個人策略命中提醒',
      '💰 平均 NT$74/月',
    ],
    cta: '立即訂閱',
  },
]

const VIP_FEATURES = [
  { icon: '🔔', title: '個人化每日推播', desc: '每天 13:30 收盤後推送你的最愛股表現' },
  { icon: '⭐', title: '突破 / 跌破警示', desc: '最愛股創新高或跌破 MA20 即時通知' },
  { icon: '💰', title: '大戶異動通知', desc: '本週大戶持股增加 ≥ 0.5% 主動推播' },
  { icon: '📊', title: '個人策略命中', desc: '你儲存的篩選策略每天自動跑，命中即通知' },
]

const FAQ = [
  { q: '可以隨時取消嗎？', a: '是的，取消後當期到期前仍享有 VIP 功能。' },
  { q: '換手機可以同步嗎？', a: '可以，登入同個 Google 帳號即可跨裝置同步收藏與策略。' },
  { q: '使用哪家金流？', a: '使用 Paddle（國際金流），支援多語言客服與快速退款流程。' },
  { q: '推播會佔用通知空間嗎？', a: '會走 Telegram bot，可隨時關閉個別推播類型。' },
]

export function VipPanel({ onBack }: Props) {
  const [showComingSoon, setShowComingSoon] = useState(false)

  const onSubscribe = () => setShowComingSoon(true)

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
            個人化推播、無限收藏、大戶異動即時通知
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
                onClick={plan.ctaDisabled ? undefined : onSubscribe}
                disabled={plan.ctaDisabled}
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
                  cursor: plan.ctaDisabled ? 'default' : 'pointer',
                }}
              >
                {plan.cta}
              </button>
            </div>
          ))}
        </div>

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

      {/* 「即將開放」modal */}
      <AlertModal
        open={showComingSoon}
        onClose={() => setShowComingSoon(false)}
        icon="crown"
        title="VIP 訂閱即將開放"
        message={
          <>
            VIP 訂閱即將開放，敬請期待 ✨
            <br />
            開放時將以 Email 通知你。
          </>
        }
        primary={{
          label: '知道了',
          onClick: () => setShowComingSoon(false),
        }}
      />
    </div>
  )
}
