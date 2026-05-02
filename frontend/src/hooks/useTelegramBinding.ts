import { useState, useEffect, useCallback, useRef } from 'react'
import {
  createBindCode,
  getBinding,
  deleteBinding,
  type BindCodeResponse,
  type BindingInfo,
} from '../api/telegram'

/**
 * useTelegramBinding — 管理使用者的 Telegram 綁定狀態 + bind code 流程
 *
 * - idToken 為 null 時：不 fetch、回傳 bound:false
 * - idToken 改變時：自動 refresh
 * - generateCode：呼 POST /api/telegram/bind-code，並開始 3 秒輪詢 binding
 * - cancelPolling：手動停止輪詢（modal 取消時用）
 * - unbind：DELETE /api/telegram/binding，refresh state
 *
 * 輪詢策略：每 3 秒一次；偵測 bound=true 立即停 + 自動關閉 modal（透過 binding state 切換）。
 * 上層 component 可看 `pollingActive` 知道是否還在等。
 */

const POLL_INTERVAL_MS = 3000

interface UseTelegramBindingResult {
  binding: BindingInfo
  loading: boolean
  error: string | null
  /** 當前產生的 bind code（modal 顯示用），尚未產或已用掉 → null */
  bindCode: BindCodeResponse | null
  /** 是否正在輪詢（modal 顯示「等待綁定中…」用） */
  pollingActive: boolean
  refresh: () => Promise<void>
  /** 產 code + 開始輪詢；回傳 code 物件給 caller 開 modal */
  generateCode: () => Promise<BindCodeResponse | null>
  /** 停止輪詢 + 清掉 bindCode（不會 DELETE 後端 code，code 自己會 10 分鐘過期） */
  cancelPolling: () => void
  /** 解除綁定 */
  unbind: () => Promise<boolean>
}

export function useTelegramBinding(idToken: string | null): UseTelegramBindingResult {
  const [binding, setBinding] = useState<BindingInfo>({ bound: false })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [bindCode, setBindCode] = useState<BindCodeResponse | null>(null)
  const [pollingActive, setPollingActive] = useState(false)

  // 用 ref 存 interval，避免 re-render 時 leak
  const pollTimerRef = useRef<number | null>(null)

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
    setPollingActive(false)
  }, [])

  const refresh = useCallback(async () => {
    if (!idToken) {
      setBinding({ bound: false })
      return
    }
    setLoading(true)
    setError(null)
    try {
      const info = await getBinding(idToken)
      setBinding(info)
      // 如果偵測到已綁定 + 還在輪詢 → 停輪詢 + 清掉 code
      if (info.bound) {
        stopPolling()
        setBindCode(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed')
    } finally {
      setLoading(false)
    }
  }, [idToken, stopPolling])

  // idToken 變動時重抓
  useEffect(() => {
    refresh()
  }, [refresh])

  // unmount 清掉 polling
  useEffect(() => {
    return () => {
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current)
      }
    }
  }, [])

  const generateCode = useCallback(async (): Promise<BindCodeResponse | null> => {
    if (!idToken) return null
    setError(null)
    // 先停掉任何前一輪輪詢（避免 leak）
    stopPolling()
    try {
      const code = await createBindCode(idToken)
      setBindCode(code)
      // 啟動輪詢
      setPollingActive(true)
      pollTimerRef.current = window.setInterval(() => {
        // 每次輪詢都重抓 binding（refresh 會在 bound=true 時自動 stop）
        refresh()
      }, POLL_INTERVAL_MS)
      return code
    } catch (e) {
      setError(e instanceof Error ? e.message : 'create code failed')
      return null
    }
  }, [idToken, refresh, stopPolling])

  const cancelPolling = useCallback(() => {
    stopPolling()
    setBindCode(null)
  }, [stopPolling])

  const unbind = useCallback(async (): Promise<boolean> => {
    if (!idToken) return false
    setError(null)
    try {
      await deleteBinding(idToken)
      setBinding({ bound: false })
      // 順手清掉任何殘留 code / 輪詢
      stopPolling()
      setBindCode(null)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unbind failed')
      return false
    }
  }, [idToken, stopPolling])

  return {
    binding,
    loading,
    error,
    bindCode,
    pollingActive,
    refresh,
    generateCode,
    cancelPolling,
    unbind,
  }
}
