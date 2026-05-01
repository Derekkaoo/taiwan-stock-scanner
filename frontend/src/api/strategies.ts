/**
 * Strategies API client — 跟 /api/strategies 串接
 * 認證用 Google ID Token（caller 提供）
 */

import type { Filters } from '../types'

const API_BASE = '/api/strategies'

export interface Strategy {
  id: number
  name: string
  filters: Filters
  created_at: number
  updated_at: number
}

interface StrategiesResponse {
  strategies: Strategy[]
  count: number
}

interface StrategyResponse {
  strategy: Strategy
}

interface ErrorResponse {
  error: string
}

function authHeader(idToken: string): HeadersInit {
  return { Authorization: `Bearer ${idToken}` }
}

async function parseOrThrow<T>(r: Response): Promise<T> {
  let data: T | ErrorResponse
  try {
    data = (await r.json()) as T | ErrorResponse
  } catch {
    throw new Error(`HTTP ${r.status}`)
  }
  if (!r.ok) {
    const msg = (data as ErrorResponse).error || `HTTP ${r.status}`
    throw new Error(msg)
  }
  if (data && typeof data === 'object' && 'error' in (data as object)) {
    throw new Error((data as ErrorResponse).error)
  }
  return data as T
}

export async function listStrategies(idToken: string): Promise<Strategy[]> {
  const r = await fetch(API_BASE, { headers: authHeader(idToken) })
  const data = await parseOrThrow<StrategiesResponse>(r)
  return data.strategies
}

export async function createStrategy(
  idToken: string,
  name: string,
  filters: Filters,
): Promise<Strategy> {
  const r = await fetch(API_BASE, {
    method: 'POST',
    headers: { ...authHeader(idToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, filters }),
  })
  const data = await parseOrThrow<StrategyResponse>(r)
  return data.strategy
}

export async function updateStrategy(
  idToken: string,
  id: number,
  patch: { name?: string; filters?: Filters },
): Promise<void> {
  const r = await fetch(`${API_BASE}/${id}`, {
    method: 'PUT',
    headers: { ...authHeader(idToken), 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  await parseOrThrow<{ ok: true; id: number }>(r)
}

export async function deleteStrategy(idToken: string, id: number): Promise<void> {
  const r = await fetch(`${API_BASE}/${id}`, {
    method: 'DELETE',
    headers: authHeader(idToken),
  })
  await parseOrThrow<{ ok: true; id: number }>(r)
}
