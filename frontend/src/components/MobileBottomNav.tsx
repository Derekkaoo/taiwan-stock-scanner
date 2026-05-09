// ============================================================
//  手機底部導航：4 個 tab（族群 / 個股 / 最愛 / 篩選）
//  fixed bottom，桌機完全不渲染（由 App 層用 useIsMobile 控制）
//  Icons：inline monoline SVG（lucide-style），不裝額外 icon 庫
// ============================================================

export type MobileTab = 'group' | 'stock' | 'favorites' | 'filter'

interface Props {
  /** 目前 active tab。filter tab 是 trigger，按下會打開 filter modal（由父層處理）*/
  tab: MobileTab
  /** 點 tab 的 callback。父層決定怎麼處理（譬如 filter tab → 開 modal + 切回 stock）*/
  onTab: (t: MobileTab) => void
  /** 已啟用的 filter 條件數，> 0 時 filter tab 顯示徽章 */
  filterActiveCount: number
  /** 收藏數量，> 0 時最愛 tab 顯示徽章 */
  favoritesCount: number
}

interface IconProps {
  size?: number
}

/** 族群 icon：2x2 方塊（4 個分類格子）*/
function IconGroup({ size = 22 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <rect x="3"    y="3"    width="7.5" height="7.5" rx="1.5"/>
      <rect x="13.5" y="3"    width="7.5" height="7.5" rx="1.5"/>
      <rect x="3"    y="13.5" width="7.5" height="7.5" rx="1.5"/>
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>
    </svg>
  )
}

/** 個股 icon：折線往上 + 右上箭頭（trending up）*/
function IconStock({ size = 22 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2"
         strokeLinejoin="round" strokeLinecap="round">
      <polyline points="3,17 9,11 13,15 21,7"/>
      <polyline points="14,7 21,7 21,14"/>
    </svg>
  )
}

/** 篩選 icon：漏斗（funnel）*/
function IconFilter({ size = 22 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="1.6"
         strokeLinejoin="round" strokeLinecap="round">
      <path d="M22 3H2l8 9.5V19l4 2v-8.5L22 3z"/>
    </svg>
  )
}

/** 我的最愛 icon：實心五角星 */
function IconFavorite({ size = 22 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"
         stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <path d="M12 2.6 14.95 9l6.55.6-4.95 4.5 1.5 6.4L12 17.3 5.95 20.5l1.5-6.4L2.5 9.6 9.05 9z"/>
    </svg>
  )
}

interface TabDef {
  key: MobileTab
  label: string
  Icon: React.FC<IconProps>
}

const TABS: TabDef[] = [
  { key: 'group',     label: '族群', Icon: IconGroup },
  { key: 'stock',     label: '個股', Icon: IconStock },
  { key: 'favorites', label: '最愛', Icon: IconFavorite },
  { key: 'filter',    label: '篩選', Icon: IconFilter },
]

export function MobileBottomNav({ tab, onTab, filterActiveCount, favoritesCount }: Props) {
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
        const Icon = t.Icon
        return (
          <button
            key={t.key}
            onClick={() => onTab(t.key)}
            aria-selected={active}
            className="relative flex-1 flex flex-col items-center justify-center gap-1 py-2"
            style={{
              background: 'transparent',
              border: 0,
              cursor: 'pointer',
              color: active ? 'var(--color-accent-cyan)' : 'var(--color-text-muted)',
              fontWeight: active ? 500 : 400,
              transition: 'color 150ms',
            }}
          >
            <Icon size={22} />
            <span style={{ fontSize: 11 }}>{t.label}</span>
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
            {t.key === 'favorites' && favoritesCount > 0 && (
              <span
                className="absolute font-mono tabular"
                style={{
                  top: 4,
                  left: '50%',
                  marginLeft: 6,
                  background: '#fbbf24',
                  color: '#1a1a1a',
                  fontSize: 9,
                  fontWeight: 600,
                  padding: '1px 5px',
                  borderRadius: 8,
                  lineHeight: 1.2,
                  minWidth: 16,
                  textAlign: 'center',
                }}
              >
                {favoritesCount}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
