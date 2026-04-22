import { useState, useCallback, useRef, useEffect } from 'react'
import type { StockRow, SortState, DataMode, ReturnPeriod } from '../types'
import { assignThemeGroup, buildGroupedStocks } from '../constants/themeGroups'

function normalizeRow(raw: Record<string, unknown>): StockRow {
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
  return {
    id:              String(raw.id ?? '').trim(),
    name:            String(raw.name ?? '').trim(),
    group:           String(raw.group ?? '').trim(),
    groupDesc:       String(raw.groupDesc ?? '').trim(),
    holdingPct:      Number(raw.holdingPct ?? 0),
    delta:           Number(raw.delta ?? 0),
    price:           Number(raw.price ?? 0),
    marketCap:       Number(raw.marketCap ?? 0),
    date:            String(raw.date ?? new Date().toISOString().slice(0, 10)),
    threeMonthReturn: raw.threeMonthReturn != null ? Number(raw.threeMonthReturn) : null,
    subIndustries,
    groups,
    subsByGroup,
    returns: parseReturns(raw.returns),
    revenueYoY:   raw.revenueYoY != null ? Number(raw.revenueYoY) : null,
    revenueMonth: raw.revenueMonth ? String(raw.revenueMonth) : null,
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

export function useStocks(returnPeriod: ReturnPeriod = 'y1') {
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
      const filtered = q
        ? allStocks.filter(s =>
            s.id.includes(q) ||
            s.name.toLowerCase().includes(q) ||
            s.group.toLowerCase().includes(q)
          )
        : [...allStocks]
      const sorted = [...filtered].sort(compare)
      setFilteredStocks(sorted)
      setGrouped(buildGroupedStocks(filtered))
    }, [returnPeriod]
  )

  // 期間切換時重新排序（個股表漲幅欄位依當前期間排）
  useEffect(() => {
    if (stocks.length > 0) {
      applyFilterSort(stocks, searchRef.current, sort)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnPeriod])

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