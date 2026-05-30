/**
 * 綠界 callback 共用 helper
 *
 * ecpay-return.ts 跟 ecpay-result.ts 都用得到的 callback 解析 + 驗簽邏輯。
 *
 * 重要設計：
 *   - parseEcpayCallback() 把 form-urlencoded body 轉成 EcpayCallbackParams
 *   - verifyEcpayCallback() 驗簽 — Phase 3 起所有 callback 第一步都要過這個
 *   - calcNewVipUntil() 算 user_status.vip_until 的延長值（renewal-safe）
 */

import { verifyEcpay } from './ecpay'

/**
 * 綠界 callback 的標準欄位（取我們會用到的部分）
 * 實際綠界會傳更多欄位（AlipayID / WebATMAccBank 等），用不到的不解析。
 *
 * 注意：所有欄位來源都是 form-urlencoded string，這裡保持 string 不轉型，
 *       讓 caller 自己決定要不要 parseInt。理由是綠界文件規範金額是整數但
 *       parseFloat 比較安全，rtn_code 也是 string '1' 而非 number 1。
 */
export interface EcpayCallbackParams {
  MerchantID: string
  MerchantTradeNo: string
  TradeNo: string                // 綠界自己的訂單號
  TradeAmt: string               // 交易金額
  PaymentDate: string            // yyyy/MM/dd HH:mm:ss
  PaymentType: string            // 譬如 Credit_CreditCard
  RtnCode: string                // '1' = 成功
  RtnMsg: string
  // 信用卡專屬
  auth_code?: string
  gwsr?: string                  // 廢止授權 / 退刷必需
  card4no?: string
  card6no?: string
  process_date?: string
  // 定期定額專屬
  PeriodAmount?: string
  PeriodType?: string            // 'M' | 'Y'
  Frequency?: string
  ExecTimes?: string
  TotalSuccessTimes?: string     // '1' = 首期，後續會 2, 3, 4...
  TotalSuccessAmount?: string
  // 驗證用
  CheckMacValue: string
  // 全包（debug 用）
  [k: string]: string | undefined
}

/**
 * 解析 ECPay callback 的 POST body（form-urlencoded）
 * 失敗回 null
 */
export async function parseEcpayCallback(
  request: Request,
): Promise<{ params: EcpayCallbackParams; raw: string } | null> {
  try {
    const raw = await request.text()
    const sp = new URLSearchParams(raw)
    const params = Object.fromEntries(sp.entries()) as unknown as EcpayCallbackParams
    if (!params.MerchantTradeNo || !params.CheckMacValue) return null
    return { params, raw }
  } catch {
    return null
  }
}

/**
 * 驗證 callback 的 CheckMacValue
 *
 * ⚠️ 任何 D1 寫操作前必須先過這關。沒驗簽就寫 D1 = 任何人都能偽造升 VIP。
 */
export async function verifyEcpayCallback(
  params: EcpayCallbackParams,
  hashKey: string,
  hashIV: string,
): Promise<boolean> {
  // verifyEcpay 已經處理 CheckMacValue 排除 + 比對
  // 把 params 強轉成 Record<string, unknown> 因為 verifyEcpay signature 需要
  return verifyEcpay(
    params as unknown as Record<string, unknown>,
    hashKey,
    hashIV,
  )
}

/**
 * 算 VIP 到期時間延長後的新值（renewal-safe）
 *
 * 規則：
 *   1. 若 user 已有 vip_until 且還沒到期 → 從原 vip_until 往後延（保留剩餘時間）
 *   2. 若 user 沒 vip_until 或已過期 → 從 now 往後延
 *
 * 例：
 *   - 首期 (現在 t=0, period=30天): 0 + 30 = 30
 *   - 第二期續約 (t=30, 現有 vip_until=30): max(30,30) + 30 = 60 ✓
 *   - 提前一天續約 (t=29, 現有 vip_until=30): max(30,29) + 30 = 60 ✓（不會 lose 1 天）
 *   - 過期後重新訂閱 (t=60, 現有 vip_until=30): max(30,60) + 30 = 90 ✓
 *
 * @param currentVipUntil 現有的 vip_until (unix sec)，null = 沒有
 * @param periodType      'M' | 'Y'（綠界欄位）
 * @param now             現在時間 (unix sec)，預設 Date.now()
 */
export function calcNewVipUntil(
  currentVipUntil: number | null,
  periodType: 'M' | 'Y',
  now: number = Math.floor(Date.now() / 1000),
): number {
  // M = 30 天；Y = 365 天（簡單模型，不考慮閏年；綠界自己也是按 ExecTimes 算）
  // 如果以後需要嚴格按月/年，可以用 Date object 算
  const periodSeconds = periodType === 'Y' ? 365 * 86400 : 30 * 86400
  const baseline = Math.max(currentVipUntil ?? 0, now)
  return baseline + periodSeconds
}

/**
 * 把綠界 process_date / PaymentDate（'yyyy/MM/dd HH:mm:ss' TW local）轉 unix sec
 * 失敗回 now
 */
export function ecpayDateToUnix(dateStr: string | undefined): number {
  if (!dateStr) return Math.floor(Date.now() / 1000)
  // 'yyyy/MM/dd HH:mm:ss' → ISO 'yyyy-MM-ddTHH:mm:ss+08:00'
  const m = /^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/.exec(dateStr)
  if (!m) return Math.floor(Date.now() / 1000)
  const [, y, mo, d, h, mi, s] = m
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}+08:00`
  const t = Date.parse(iso)
  if (isNaN(t)) return Math.floor(Date.now() / 1000)
  return Math.floor(t / 1000)
}
