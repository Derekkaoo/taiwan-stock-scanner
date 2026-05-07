// ============================================================
//  手機底部導航：3 個 tab（族群 / 個股 / 篩選）
//  fixed bottom，桌機完全不渲染（由 App 層用 useIsMobile 控制）
// ============================================================

export type MobileTab = 'group' | 'stock' | 'filter'

interface Props {
  /** 目前 active tab。filter tab 是 trigger，按下會打開 filter modal（由父層處理）*/
  tab: MobileTab
  /** 點 tab 的 callback。父層決定怎麼處理（譬如 filter tab → 開 modal + 切回 stock）*/
  onTab: (t: MobileTab) => void
  /** 已啟用的 filter 條件數，> 0 時 filter tab 顯示徽章 */
  filterActiveCount: number
}

interface TabDef {
  key: MobileTab
  label: string
  icon: string
}

const TABS: TabDef[] = [
  { key: 'group',  label: '族群', icon: '📊' },
  { key: 'stock',  label: '個股', icon: '📈' },
  { key: 'filter', label: '篩選', icon: '🔍' },
]

export function MobileBottomNav({ tab, onTab, filterActiveCount }: Props) {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 flex border-t"
      style={{
        background: 'var(--color-bg-700)',
        borderColor: 'var(--color-border)',
        // iPhone home indicator 留空間
        paddingBottom: 'env(safe-area-inset-bottom, 0)',
      }}
      aria-label="底部導航"
    >
      {TABS.map(t => {
        const active = tab === t.key
        return (
          <button
            key={t.key}
            onClick={() => onTab(t.key)}
            aria-selected={active}
            className="relative flex-1 flex flex-col items-center justify-center gap-0.5 py-2"
            style={{
              background: 'transparent',
              border: 0,
              cursor: 'pointer',
              color: active ? 'var(--color-accent-cyan)' : 'var(--color-text-muted)',
              fontWeight: active ? 500 : 400,
              transition: 'color 150ms',
            }}
          >
            <span style={{ fontSize: 18, lineHeight: 1 }}>{t.icon}</span>
            <span style={{ fontSize: 10 }}>{t.label}</span>
            {t.key === 'filter' && filterActiveCount > 0 && (
              <span
                className="absolute font-mono tabular"
                style={{
                  top: 4,
                  left: '50%',
                  marginLeft: 6,
                  background: 'var(--color-accent-cyan)',
                  color: '#fff',
                  fontSize: 9,
                  fontWeight: 600,
                  padding: '1px 5px',
                  borderRadius: 8,
                  lineHeight: 1.2,
                  minWidth: 16,
                  textAlign: 'center',
                }}
              >
                {filterActiveCount}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
