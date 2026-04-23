import { useCallback, useRef, useState } from 'react'
import type { KlineBar } from '../types'

const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/'

function generateMockKline(stockId: string): KlineBar[] {
  const seed = stockId.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  const rand = (min: number, max: number, s: number) => {
    const x = Math.sin(s) * 10000
    return min + (x - Math.floor(x)) * (max - min)
  }
  const days = 130
  const basePrice = 50 + (seed % 300)
  const data: KlineBar[] = []
  let price = basePrice
  for (let i = 0; i < days; i++) {
    const change = rand(-0.04, 0.04, seed + i * 7.3)
    const open = price
    price = price * (1 + change)
    const high = Math.max(open, price) * (1 + rand(0, 0.015, seed + i * 3.1))
    const low  = Math.min(open, price) * (1 - rand(0, 0.015, seed + i * 5.7))
    const date = new Date(Date.now() - (days - i) * 86400000)
    data.push({
      date: date.toLocaleDateString('zh-TW'),
      o: +open.toFixed(2), h: +high.toFixed(2),
      l: +low.toFixed(2),  c: +price.toFixed(2),
      v: Math.floor(rand(1000, 80000, seed + i * 2.1)),
    })
  }
  return data
}

interface YahooQuote {
  open?: number[]
  high?: number[]
  low?: number[]
  close?: number[]
  volume?: number[]
}

function parseYahooResponse(json: unknown): KlineBar[] | null {
  const data = json as {
    chart?: {
      result?: Array<{
        timestamp: number[]
        indicators: { quote: YahooQuote[] }
      }>
    }
  }
  const result = data?.chart?.result?.[0]
  if (!result) return null
  const { timestamp = [], indicators } = result
  const ohlcv: YahooQuote = indicators?.quote?.[0] ?? {}
  return timestamp.map((ts, i) => ({
    date: new Date(ts * 1000).toLocaleDateString('zh-TW'),
    o: ohlcv.open?.[i]   ?? 0,
    h: ohlcv.high?.[i]   ?? 0,
    l: ohlcv.low?.[i]    ?? 0,
    c: ohlcv.close?.[i]  ?? 0,
    v: ohlcv.volume?.[i] ?? 0,
  })).filter(d => d.c > 0)
}

export function calcThreeMonthReturn(data: KlineBar[]): number | null {
  if (data.length < 2) return null
  const first = data[0].c
  const last  = data[data.length - 1].c
  if (!first) return null
  return +((last - first) / first * 100).toFixed(2)
}

export function calcMA(closes: number[], period: number): (number | null)[] {
  return closes.map((_, i) => {
    if (i < period - 1) return null
    const sum = closes.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0)
    return +(sum / period).toFixed(2)
  })
}

export function useKline() {
  const cache = useRef<Map<string, KlineBar[]>>(new Map())
  const [statusMap, setStatusMap] = useState<Record<string, 'loading' | 'ok' | 'error'>>({})
  // cacheVersion：每次 cache 有大改動就 +1，讓 subscribers 知道要重新讀 cache
  const [cacheVersion, setCacheVersion] = useState(0)
  const bump = useCallback(() => setCacheVersion(v => v + 1), [])

  const loadFromJson = useCallback(async () => {
    try {
      // cache-bust：避免 CDN / 瀏覽器 serve 舊檔
      const resp = await fetch('/data/klines.json?t=' + Date.now())
      if (!resp.ok) return
      const json: Record<string, KlineBar[]> = await resp.json()
      let count = 0
      for (const [id, bars] of Object.entries(json)) {
        if (bars && bars.length > 0) {
          cache.current.set(id, bars)
          count++
        }
      }
      console.log(`[useKline] 從 klines.json 載入 ${count} 支`)
      bump()
    } catch (e) {
      console.warn('[useKline] 無法載入 klines.json', e)
    }
  }, [bump])

  const fetchOne = useCallback(async (stockId: string): Promise<KlineBar[]> => {
    if (cache.current.has(stockId)) return cache.current.get(stockId)!
    setStatusMap(prev => ({ ...prev, [stockId]: 'loading' }))

    for (const suffix of ['.TW', '.TWO']) {
      try {
        const url = `${YAHOO_BASE}${stockId}${suffix}?interval=1d&range=1y`
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 8000)
        const resp = await fetch(url, { signal: controller.signal })
        clearTimeout(timer)
        if (!resp.ok) continue
        const json: unknown = await resp.json()
        const bars = parseYahooResponse(json)
        if (bars && bars.length >= 5) {
          cache.current.set(stockId, bars)
          setStatusMap(prev => ({ ...prev, [stockId]: 'ok' }))
          return bars
        }
      } catch { /* continue */ }
    }

    // 不再用 mock 資料（避免使用者誤以為真資料）
    setStatusMap(prev => ({ ...prev, [stockId]: 'error' }))
    return []
  }, [])

  // 已載入過的族群檔（避免重複 fetch 同一個族群檔）
  const loadedGroups = useRef<Set<string>>(new Set())
  // 正在飛的請求 → 併發呼叫同一族群會 await 同一個 promise，避免 race condition
  const inFlightGroups = useRef<Map<string, Promise<void>>>(new Map())

  const loadGroupFile = useCallback(async (groupName: string): Promise<void> => {
    if (loadedGroups.current.has(groupName)) return
    const existing = inFlightGroups.current.get(groupName)
    if (existing) return existing

    const promise = (async () => {
      try {
        // 把 / 先換成 _（與 pipeline 一致），再 URL-encode 中文字
        const safe = encodeURIComponent(groupName.replace(/[/\\]/g, '_'))
        // cache-bust：避免載到舊檔
        const resp = await fetch(`/data/klines/${safe}.json?t=${Date.now()}`)
        if (!resp.ok) {
          console.warn(`[useKline] klines/${safe}.json 不存在 (${resp.status})`)
          return
        }
        const json: Record<string, KlineBar[]> = await resp.json()
        for (const [id, bars] of Object.entries(json)) {
          if (bars && bars.length > 0) {
            cache.current.set(id, bars)
          }
        }
        loadedGroups.current.add(groupName)
        bump()
      } catch (e) {
        console.warn(`[useKline] 載入 ${groupName} 族群檔失敗`, e)
      } finally {
        inFlightGroups.current.delete(groupName)
      }
    })()

    inFlightGroups.current.set(groupName, promise)
    return promise
  }, [bump])

  // 清空 cache（手動更新時呼叫，下次展開會重抓）
  const clearCache = useCallback(() => {
    cache.current.clear()
    loadedGroups.current.clear()
    inFlightGroups.current.clear()
    setStatusMap({})
    bump()
  }, [bump])

  // 展開族群時呼叫：先抓對應族群檔（一個 HTTP，拿該族群所有股票的 K 線），
  // 若檔案缺或缺某支，再用 Yahoo fetchOne 作 fallback
  const fetchGroup = useCallback(async (
    groupName: string,
    stockIds: string[],
    onEach?: (id: string, bars: KlineBar[]) => void,
  ) => {
    await loadGroupFile(groupName)
    const tasks = stockIds.map(async (id) => {
      let bars = cache.current.get(id)
      if (!bars) {
        bars = await fetchOne(id)
      }
      onEach?.(id, bars)
      return { id, bars }
    })
    await Promise.allSettled(tasks)
  }, [fetchOne, loadGroupFile])

  const getFromCache = useCallback((stockId: string) => {
    return cache.current.get(stockId) ?? null
  }, [])

  return { fetchOne, fetchGroup, getFromCache, loadFromJson, statusMap, cacheVersion, clearCache }
}