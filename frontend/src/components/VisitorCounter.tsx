import { useEffect, useState } from 'react'

// 計數儲存在 Firebase Realtime Database，URL 對應專案
// 規則（Firebase Console 已設）：
//   ".read":  true
//   ".write": newData 必須 = data + 1，防止亂設
const DB_URL = 'https://taiwan-stock-scanner-default-rtdb.asia-southeast1.firebasedatabase.app'
const VIEWS_ENDPOINT = `${DB_URL}/views.json`

// 防止同一瀏覽器重複計數
const STORAGE_LAST_VISIT = 'tss_last_visit'
// 自己用：在 DevTools 執行  localStorage.setItem('tss_admin','1')  就永遠不計
const STORAGE_ADMIN      = 'tss_admin'


async function readCount(): Promise<number> {
  const r = await fetch(VIEWS_ENDPOINT)
  if (!r.ok) throw new Error(`read failed: HTTP ${r.status}`)
  const v = await r.json()
  return typeof v === 'number' ? v : 0
}

async function writeCount(next: number): Promise<void> {
  const r = await fetch(VIEWS_ENDPOINT, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(next),
  })
  if (!r.ok) throw new Error(`write failed: HTTP ${r.status}`)
}


export function VisitorCounter() {
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    const today     = new Date().toISOString().slice(0, 10)
    const lastVisit = localStorage.getItem(STORAGE_LAST_VISIT)
    const isAdmin   = localStorage.getItem(STORAGE_ADMIN) === '1'
    const shouldIncrement = !isAdmin && lastVisit !== today

    readCount()
      .then(async current => {
        if (!shouldIncrement) {
          setCount(current)
          return
        }
        try {
          const next = current + 1
          await writeCount(next)
          localStorage.setItem(STORAGE_LAST_VISIT, today)
          setCount(next)
        } catch {
          // 寫入失敗（race condition 或規則不符）→ 顯示讀到的數字即可
          setCount(current)
        }
      })
      .catch(() => { /* DB 連不上時靜默失敗，不影響其他 UI */ })
  }, [])

  if (count === null) return null
  return (
    <span className="visitor-counter font-mono tabular">
      瀏覽人數: {count.toLocaleString()}
    </span>
  )
}
