import { useState, useCallback, useRef, useEffect } from 'react'
import type { StockRow, SortState, DataMode, ReturnPeriod, TurnoverPeriod } from '../types'
import { assignThemeGroup, buildGroupedStocks } from '../constants/themeGroups'

export function normalizeRow(raw: Record<string, unknown>): StockRow {
  const groups = Array.isArray(raw.groups)
    ? (raw.groups as unknown[]).map(g => String(g).trim()).filter(Boolean)
    : undefined
  const subIndustries = Array.isArray(raw.subIndustries)
    ? (raw.subIndustries as unknown[]).map(s => String(s).trim()).filter(Boolean)
    : undefined
  const rawSbg = raw.subsByGroup
  const subsByGroup: Record<string, string[]> | undefined = (rawSbg && typeof rawSbg === 'object' && !Array.isArray(rawSbg))
    ? Object.fromEntries(
        Object.entries(rawSbg as Record<string, unknown>).map(([k, v]) => [
          k,
          Array.isArray(v) ? (v as unknown[]).map(x => String(x).trim()).filter(Boolean) : [],
        ])
      )
    : undefined
  const delta     = Number(raw.delta ?? 0)
  const marketCap = Number(raw.marketCap ?? 0)
  // 衍生欄位：週增金額（億）= delta% × 市值（億）/ 100
  const deltaAmount = (delta && marketCap) ? (delta * marketCap) / 100 : 0
  return {
    id:              String(raw.id ?? '').trim(),
    name:            String(raw.name ?? '').trim(),
    group:           String(raw.group ?? '').trim(),
    groupDesc:       String(raw.groupDesc ?? '').trim(),
    holdingPct:      Number(raw.holdingPct ?? 0),
    delta,
    price:           Number(raw.price ?? 0),
    marketCap,
    deltaAmount,
    turnovers:       parseTurnovers(raw.turnovers),
    volumes:         parseVolumes(raw.volumes),
    date:            String(raw.date ?? new Date().toISOString().slice(0, 10)),
    threeMonthReturn: raw.threeMonthReturn != null ? Number(raw.threeMonthReturn) : null,
    subIndustries,
    groups,
    subsByGroup,
    returns: parseReturns(raw.returns),
    revenueYoY:   raw.revenueYoY != null ? Number(raw.revenueYoY) : null,
    revenueMonth: raw.revenueMonth ? String(raw.revenueMonth) : null,
    revenueFirstSeen: raw.revenueFirstSeen ? String(raw.revenueFirstSeen) : null,
    fundamentals: parseFundamentals(raw.fundamentals),
    companyProfile: parseCompanyProfile(raw.companyProfile),
    foreignBuyStreak: raw.foreignBuyStreak != null ? Number(raw.foreignBuyStreak) : undefined,
    trustBuyStreak:   raw.trustBuyStreak   != null ? Number(raw.trustBuyStreak)   : undefined,
    market:           raw.market === '上市' || raw.market === '上櫃' ? raw.market : undefined,
    industry:         typeof raw.industry === 'string' ? raw.industry : undefined,
    // archive 帶來的「最後一次入榜」日期（給 ghost row UI 顯示「資料 N 週前」）
    _lastSeenDate:    typeof raw._lastSeenDate === 'string' ? raw._lastSeenDate : undefined,
  }
}

function parseCompanyProfile(raw: unknown): StockRow['companyProfile'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const r = raw as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const k of [
    'business', 'chairman', 'ceo', 'spokesman', 'deputySpokesman',
    'foundedDate', 'listedDate', 'address', 'phone', 'fax', 'email',
    'website', 'capital', 'sharesOutstanding', 'employees', 'group',
    'auditor', 'englishName',
  ]) {
    if (r[k]) out[k] = String(r[k])
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function parseFundamentals(raw: unknown): StockRow['fundamentals'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const r = raw as Record<string, unknown>
  const parseDateArr = (v: unknown) => Array.isArray(v)
    ? (v as Array<Record<string, unknown>>)
        .filter(o => o && typeof o === 'object')
        .map(o => ({ date: String(o.date ?? ''), yoy: Number(o.yoy ?? 0) }))
        .filter(x => x.date)
    : undefined
  const parseQArr = (v: unknown) => Array.isArray(v)
    ? (v as Array<Record<string, unknown>>)
        .filter(o => o && typeof o === 'object')
        .map(o => ({ quarter: String(o.quarter ?? ''), yoy: Number(o.yoy ?? 0) }))
        .filter(x => x.quarter)
    : undefined
  const parseAbsArr = (v: unknown) => Array.isArray(v)
    ? (v as Array<Record<string, unknown>>)
        .filter(o => o && typeof o === 'object')
        .map(o => ({ quarter: String(o.quarter ?? ''), value: Number(o.value ?? 0) }))
        .filter(x => x.quarter)
    : undefined
  return {
    revenueYoY:         parseDateArr(r.revenueYoY),
    grossMarginYoY:     parseQArr(r.grossMarginYoY),
    operatingMarginYoY: parseQArr(r.operatingMarginYoY),
    epsYoY:             parseQArr(r.epsYoY),
    grossMargin:        parseAbsArr(r.grossMargin),
    operatingMargin:    parseAbsArr(r.operatingMargin),
    eps:                parseAbsArr(r.eps),
  }
}

function parseReturns(raw: unknown): StockRow['returns'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const r = raw as Record<string, unknown>
  const periods: Array<'w1'|'m1'|'m3'|'m6'|'y1'> = ['w1','m1','m3','m6','y1']
  const out: Record<string, number | null> = {}
  for (const k of periods) {
    const v = r[k]
    out[k] = v == null ? null : Number(v)
  }
  return out
}

function parseTurnovers(raw: unknown): StockRow['turnovers'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const r = raw as Record<string, unknown>
  const periods: Array<'d1'|'d5'|'d10'|'d20'> = ['d1','d5','d10','d20']
  const out: Record<string, number> = {}
  for (const k of periods) {
    const v = r[k]
    if (v != null) out[k] = Number(v)
  }
  return out
}

/** 後端 volumes 是「千張」單位，前端統一轉成「張」直覺顯示 */
function parseVolumes(raw: unknown): StockRow['volumes'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const r = raw as Record<string, unknown>
  const periods: Array<'d1'|'d5'|'d10'|'d20'> = ['d1','d5','d10','d20']
  const out: Record<string, number> = {}
  for (const k of periods) {
    const v = r[k]
    if (v != null) out[k] = Math.round(Number(v) * 1000)   // 千張 → 張
  }
  return out
}

export function useStocks(returnPeriod: ReturnPeriod = 'y1', turnoverPeriod: TurnoverPeriod = 'd5') {
  const [stocks,         setStocks]         = useState<StockRow[]>([])
  const [filteredStocks, setFilteredStocks] = useState<StockRow[]>([])
  const [grouped,        setGrouped]        = useState<Record<string, StockRow[]>>({})
  const [sort,           setSort]           = useState<SortState>({ key: 'delta', dir: 'desc' })
  const [loading,        setLoading]        = useState(false)
  const [error,          setError]          = useState<string | null>(null)
  const [searchQuery,    setSearchQueryRaw] = useState('')
  const [lastUpdated,    setLastUpdated]    = useState<string | null>(null)
  const [dataDate,       setDataDate]       = useState<string | null>(null)
  const searchRef = useRef('')

  const processRows = useCallback((rows: StockRow[]): StockRow[] => {
    return rows.filter(r => r.id && r.id.length >= 4).map(r => ({
      ...r,
      group: r.group || assignThemeGroup(r.id),
    }))
  }, [])

  const applyFilterSort = useCallback(
    (allStocks: StockRow[], query: string, currentSort: SortState) => {
      const getSortVal = (row: StockRow): unknown => {
        if (currentSort.key === 'threeMonthReturn') {
          const v = row.returns && row.returns[returnPeriod]
          return v == null ? row.threeMonthReturn : v
        }
        if (currentSort.key === 'turnovers') {
          return row.turnovers?.[turnoverPeriod] ?? 0
        }
        return row[currentSort.key]
      }
      const compare = (a: StockRow, b: StockRow): number => {
        const av = getSortVal(a)
        const bv = getSortVal(b)
        if (av === null || av === undefined) return 1
        if (bv === null || bv === undefined) return -1
        let cmp: number
        if (typeof av === 'string' && typeof bv === 'string') {
          cmp = av.localeCompare(bv)
        } else {
          cmp = (av as number) - (bv as number)
        }
        return currentSort.dir === 'asc' ? cmp : -cmp
      }
      const q = query.toLowerCase().trim()
      // 預設只顯示「本週入榜」（delta >= 0.1%）的股票
      // 後端現在抓全部股票（含 < 0.1% / 負值）→ 主畫面前端過濾
      // 「我的最愛」模式在 App.tsx 內繞過此過濾，從原始 stocks 抓完整資料
      const inWeek = allStocks.filter(s => s.delta >= 0.1)
      const filtered = q
        ? inWeek.filter(s => {
            // 代號
            if (s.id.includes(q)) return true
            // 名稱
            if (s.name.toLowerCase().includes(q)) return true
            // 族群（主要 + 多重）
            if (s.group.toLowerCase().includes(q)) return true
            if (s.groups?.some(g => g.toLowerCase().includes(q))) return true
            // TWSE 產業別 + 子產業
            if (s.industry?.toLowerCase().includes(q)) return true
            if (s.subIndustries?.some(si => si.toLowerCase().includes(q))) return true
            return false
          })
        : [...inWeek]
      const sorted = [...filtered].sort(compare)
      setFilteredStocks(sorted)
      setGrouped(buildGroupedStocks(filtered))
    }, [returnPeriod, turnoverPeriod]
  )

  // 期間切換時重新排序（個股表漲幅欄位依當前期間排）
  useEffect(() => {
    if (stocks.length > 0) {
      applyFilterSort(stocks, searchRef.current, sort)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnPeriod, turnoverPeriod])

  const loadData = useCallback(async (_mode?: DataMode) => {
    setLoading(true)
    setError(null)
    try {
      const resp = await fetch('/data/stocks.json?t=' + Date.now())
      if (!resp.ok) throw new Error(`讀取失敗：HTTP ${resp.status}`)
      const raw: Record<string, unknown>[] = await resp.json()
      const processed = processRows(raw.map(normalizeRow))
      setStocks(processed)
      applyFilterSort(processed, searchRef.current, sort)
      setLastUpdated(new Date().toLocaleString('zh-TW'))
      if (processed.length > 0 && processed[0].date) {
        setDataDate(processed[0].date)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [processRows, applyFilterSort, sort])

  const setSearchQuery = useCallback((q: string) => {
    searchRef.current = q
    setSearchQueryRaw(q)
    setStocks(prev => { applyFilterSort(prev, q, sort); return prev })
  }, [applyFilterSort, sort])

  const updateSort = useCallback((key: SortState['key']) => {
    setSort(prev => {
      const newSort: SortState = {
        key,
        dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc',
      }
      applyFilterSort(stocks, searchRef.current, newSort)
      return newSort
    })
  }, [stocks, applyFilterSort])

  const updateStockReturn = useCallback((stockId: string, ret: number) => {
    setStocks(prev => {
      const updated = prev.map(s => s.id === stockId ? { ...s, threeMonthReturn: ret } : s)
      applyFilterSort(updated, searchRef.current, sort)
      return updated
    })
  }, [applyFilterSort, sort])

  return {
    stocks, filteredStocks, grouped, sort, loading, error,
    searchQuery, lastUpdated, dataDate,
    loadData, setSearchQuery, updateSort, updateStockReturn,
  }
}
