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

  const loadFromJson = useCallback(async () => {
    try {
      const resp = await fetch('/data/klines.json')
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
    } catch (e) {
      console.warn('[useKline] 無法載入 klines.json', e)
    }
  }, [])

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

    const mockBars = generateMockKline(stockId)
    cache.current.set(stockId, mockBars)
    setStatusMap(prev => ({ ...prev, [stockId]: 'ok' }))
    return mockBars
  }, [])

  const fetchGroup = useCallback(async (
    stockIds: string[],
    onEach?: (id: string, bars: KlineBar[]) => void,
  ) => {
    const tasks = stockIds.map(async (id) => {
      const bars = await fetchOne(id)
      onEach?.(id, bars)
      return { id, bars }
    })
    await Promise.allSettled(tasks)
  }, [fetchOne])

  const getFromCache = useCallback((stockId: string) => {
    return cache.current.get(stockId) ?? null
  }, [])

  return { fetchOne, fetchGroup, getFromCache, loadFromJson, statusMap }
}