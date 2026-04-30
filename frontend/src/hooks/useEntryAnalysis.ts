import { useState, useEffect } from 'react'
import type { EntryAnalysis } from '../types'

// 全域 cache（單次 app session 載入一次就好）
let cache: Record<string, EntryAnalysis> | null = null
let cachePromise: Promise<Record<string, EntryAnalysis>> | null = null

function snakeToCamel<T = unknown>(obj: T): T {
  if (Array.isArray(obj)) return obj.map(snakeToCamel) as unknown as T
  if (obj && typeof obj === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const newKey = k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
      out[newKey] = snakeToCamel(v)
    }
    return out as T
  }
  return obj
}

async function loadAll(): Promise<Record<string, EntryAnalysis>> {
  if (cache) return cache
  if (cachePromise) return cachePromise
  cachePromise = (async () => {
    try {
      const r = await fetch('/data/entry_analysis.json?t=' + Date.now())
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const raw = await r.json() as { by_stock?: Record<string, unknown> }
      const bs = raw.by_stock || {}
      const result: Record<string, EntryAnalysis> = {}
      for (const [sid, v] of Object.entries(bs)) {
        if (v && typeof v === 'object') {
          result[sid] = snakeToCamel(v) as EntryAnalysis
        }
      }
      cache = result
      return cache
    } catch (e) {
      console.warn('Entry analysis load failed:', e)
      cache = {}
      return cache
    }
  })()
  return cachePromise
}

export function useEntryAnalysis(stockId: string | null | undefined) {
  const [data, setData] = useState<EntryAnalysis | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let aborted = false
    if (!stockId) {
      setData(null)
      return
    }
    setLoading(true)
    loadAll().then(all => {
      if (aborted) return
      setData(all[stockId] || null)
      setLoading(false)
    })
    return () => { aborted = true }
  }, [stockId])

  return { data, loading }
}
