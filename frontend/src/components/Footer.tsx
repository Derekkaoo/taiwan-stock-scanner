/**
 * Footer — 極簡頁尾
 *
 * 設計原則：
 *   - 不搶注意力，用 --color-text-muted 小字呈現
 *   - 提供 About / Disclaimer / Privacy 連結（AdSense 與 affiliate 必要）
 *   - 桌機一行呈現，手機自動換行
 *   - 點擊連結會跳到靜態 HTML 頁（public/about.html 等），不走 SPA router
 */
export function Footer() {
  const year = new Date().getFullYear()

  const linkStyle: React.CSSProperties = {
    color: 'var(--color-text-muted)',
    textDecoration: 'none',
  }

  const dotStyle: React.CSSProperties = {
    color: 'var(--color-text-muted)',
    opacity: 0.5,
  }

  return (
    <footer
      className="border-t px-5 py-3 flex flex-wrap items-center gap-2 text-[11px]"
      style={{
        borderColor: 'var(--color-border)',
        background: 'var(--color-bg-700)',
        color: 'var(--color-text-muted)',
      }}
    >
      <span>© {year} 千張大戶持股追蹤器</span>
      <span style={dotStyle}>·</span>
      <a href="/about.html" style={linkStyle} className="hover:underline">
        關於本站
      </a>
      <span style={dotStyle}>·</span>
      <a href="/disclaimer.html" style={linkStyle} className="hover:underline">
        免責聲明
      </a>
      <span style={dotStyle}>·</span>
      <a href="/privacy.html" style={linkStyle} className="hover:underline">
        隱私權政策
      </a>
      <span
        className="ml-auto hidden sm:inline"
        style={{ opacity: 0.7, fontSize: 10 }}
      >
        資料僅供參考，非投資建議
      </span>
    </footer>
  )
}
