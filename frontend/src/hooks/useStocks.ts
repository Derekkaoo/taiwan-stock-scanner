import { useState, useCallback, useRef } from 'react'
import type { StockRow, SortState, DataMode } from '../types'
import { assignThemeGroup, buildGroupedStocks } from '../constants/themeGroups'

function normalizeRow(raw: Record<string, unknown>): StockRow {
  return {
    id:              String(raw.id ?? '').trim(),
    name:            String(raw.name ?? '').trim(),
    group:           String(raw.group ?? '').trim(),
    holdingPct:      Number(raw.holdingPct ?? 0),
    delta:           Number(raw.delta ?? 0),
    price:           Number(raw.price ?? 0),
    marketCap:       Number(raw.marketCap ?? 0),
    date:            String(raw.date ?? new Date().toISOString().slice(0, 10)),
    threeMonthReturn: raw.threeMonthReturn != null ? Number(raw.threeMonthReturn) : null,
  }
}

function compareStocks(a: StockRow, b: StockRow, sort: SortState): number {
  const av = a[sort.key]
  const bv = b[sort.key]
  if (av === null || av === undefined) return 1
  if (bv === null || bv === undefined) return -1
  let cmp: number
  if (typeof av === 'string' && typeof bv === 'string') {
    cmp = av.localeCompare(bv)
  } else {
    cmp = (av as number) - (bv as number)
  }
  return sort.dir === 'asc' ? cmp : -cmp
}

export function useStocks() {
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
      const q = query.toLowerCase().trim()
      const filtered = q
        ? allStocks.filter(s =>
            s.id.includes(q) ||
            s.name.toLowerCase().includes(q) ||
            s.group.toLowerCase().includes(q)
          )
        : [...allStocks]
      const sorted = [...filtered].sort((a, b) => compareStocks(a, b, currentSort))
      setFilteredStocks(sorted)
      setGrouped(buildGroupedStocks(filtered))
    }, []
  )

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
      // 取資料截至日期（從第一筆的 date 欄位）
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
