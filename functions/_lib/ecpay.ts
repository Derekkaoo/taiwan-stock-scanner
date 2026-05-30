/**
 * 綠界 ECPay 共用 helper — CheckMacValue 計算 + 驗證
 *
 * 用途：
 *   - signEcpay(params, hashKey, hashIV)   → 計算 CheckMacValue（出口端用）
 *   - verifyEcpay(params, hashKey, hashIV) → 驗證 callback 的 CheckMacValue（入口端用）
 *   - buildEcpayForm(...)                  → 給 create-order 端點用，回傳完整 form 欄位
 *
 * 演算法（V5, SHA256，依綠界 AllInOne 文件）：
 *   1. 從 params 排除 CheckMacValue + null/undefined
 *   2. 按 key 字母順序排序（不分大小寫）
 *   3. 串接成 `HashKey=<hashKey>&k1=v1&k2=v2&...&HashIV=<hashIV>`
 *   4. .NET HttpUtility.UrlEncode 風格 URL encode（差別：空格→+、!'()*不編碼、hex 小寫）
 *   5. 全部小寫
 *   6. SHA256
 *   7. 全部大寫 hex
 *
 * ⚠️ 重點：
 *   - Cloudflare Workers 沒 Node `crypto`，要用 Web Crypto API（crypto.subtle.digest）
 *   - 因為 async，所以 signEcpay 是 async function
 *   - 跟 scripts/test_ecpay_helper.mjs 的演算法必須 1:1 一致（兩邊都改）
 *
 * 驗證方式：
 *   1. 本地跑 `node scripts/test_ecpay_helper.mjs` 看 mjs 版輸出
 *   2. 把同樣輸入貼到綠界後台 → 系統開發工具 → CheckMacValue 產生器
 *      （stage: https://vendor-stage.ecpay.com.tw / production: https://vendor.ecpay.com.tw）
 *   3. 兩邊輸出一致 → mjs 演算法正確 → 這份 .ts 也正確
 */

/**
 * .NET HttpUtility.UrlEncode 風格的 URL encode
 *
 * JS encodeURIComponent 跟 .NET UrlEncode 差別：
 *   - 空格：.NET 用 `+`，JS 用 `%20`     → 補：%20 → +
 *   - 這 5 個字 .NET 不編碼：! ' ( ) *   → 補：%21 / %27 / %28 / %29 / %2A 換回原字
 *   - hex 大小寫：.NET 用小寫，JS 用大寫 → 補：所有 %XX 小寫化
 *
 * 注意順序：先 replace 個別 %XX，最後再統一 lowercase hex，
 *           不然會把 `%21` 變 `!` 之後又被誤觸 lowercase pass。
 */
function dotnetUrlEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/%20/g, '+')
    .replace(/%21/g, '!')
    .replace(/%27/g, "'")
    .replace(/%28/g, '(')
    .replace(/%29/g, ')')
    .replace(/%2A/g, '*')
    .replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase())
}

/**
 * 把任意 value 安全轉成字串（給 form-urlencoded 用）
 * - null/undefined → 不要傳這個 key（caller 應該已 filter）
 * - 其他 → String(v)
 */
function stringifyValue(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v)
}

/**
 * 計算綠界 CheckMacValue
 *
 * @param params  要簽章的全部欄位（不含 CheckMacValue）
 * @param hashKey 綠界 HashKey
 * @param hashIV  綠界 HashIV
 * @returns       64 字大寫 hex SHA256
 */
export async function signEcpay(
  params: Record<string, unknown>,
  hashKey: string,
  hashIV: string,
): Promise<string> {
  // 1. 排除 CheckMacValue + null/undefined（empty string '' 仍保留 — 跟綠界 PHP SDK 一致）
  const entries = Object.entries(params)
    .filter(([k, v]) => k !== 'CheckMacValue' && v !== null && v !== undefined)
    .map(([k, v]) => [k, stringifyValue(v)] as const)
    // 2. 按 key 字母順序（不分大小寫）
    .sort(([a], [b]) => {
      const al = a.toLowerCase()
      const bl = b.toLowerCase()
      if (al < bl) return -1
      if (al > bl) return 1
      return 0
    })

  // 3. 組原字串：HashKey=...&k1=v1&...&HashIV=...
  const inner = entries.map(([k, v]) => `${k}=${v}`).join('&')
  const raw = `HashKey=${hashKey}&${inner}&HashIV=${hashIV}`

  // 4 + 5. .NET URL encode + 全部小寫
  const encoded = dotnetUrlEncode(raw).toLowerCase()

  // 6. SHA256
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(encoded))

  // 7. 全部大寫 hex
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

/**
 * 驗證綠界 callback 的 CheckMacValue
 *
 * @param params  從 ECPay 收到的 callback params（含 CheckMacValue）
 * @returns       true = 驗證通過；false = 偽造 / 被竄改 / 演算法不一致
 */
export async function verifyEcpay(
  params: Record<string, unknown>,
  hashKey: string,
  hashIV: string,
): Promise<boolean> {
  const received = stringifyValue(params.CheckMacValue).toUpperCase()
  if (!received) return false
  const expected = await signEcpay(params, hashKey, hashIV)
  return received === expected
}

// ───────────────────────────────────────────────────────────
// 環境 / 端點 URL
// ───────────────────────────────────────────────────────────

export type EcpayEnv = 'stage' | 'production'

/**
 * 各 ECPay 端點的 base URL
 *
 * AIO（信用卡定期定額也走 AIO 端點，只是 ChoosePayment=Credit + PeriodAmount/PeriodType 等）
 */
export const ECPAY_ENDPOINTS = {
  stage: {
    aio: 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5',
    // 廢止授權（停止下次扣款）
    cancelCreditPeriod:
      'https://payment-stage.ecpay.com.tw/Cashier/CreditCardPeriodAction',
    // 信用卡退刷（首次部分退、全額退）— 一般在後台處理，留 API 備用
    creditDetailDoAction:
      'https://payment-stage.ecpay.com.tw/CreditDetail/DoAction',
  },
  production: {
    aio: 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5',
    cancelCreditPeriod:
      'https://payment.ecpay.com.tw/Cashier/CreditCardPeriodAction',
    creditDetailDoAction:
      'https://payment.ecpay.com.tw/CreditDetail/DoAction',
  },
} as const satisfies Record<EcpayEnv, Record<string, string>>

/**
 * 取得 endpoint URL
 */
export function getEcpayEndpoint(
  env: EcpayEnv,
  kind: keyof (typeof ECPAY_ENDPOINTS)['stage'],
): string {
  return ECPAY_ENDPOINTS[env][kind]
}

// ───────────────────────────────────────────────────────────
// MerchantTradeNo 產生器
// ───────────────────────────────────────────────────────────

/**
 * 產生綠界用的 MerchantTradeNo（必須英數，<= 20 字）
 *
 * 格式：`<prefix><yyyymmddhhmm><random6>`
 *   例：TSS202605301930A1B2C3
 *
 * - prefix 給 3 字，"TSS" = Taiwan Stock Scanner
 * - yyyymmddhhmm = 12 字 TW 時區（不放秒讓總長 <=20）
 * - random6 = 6 字英數
 * 總共 3 + 12 + 6 = 21... 超了，改 prefix 2 字 + random 5 字 = 19 字 (含時間 12 字 = 19)
 *
 * 改：`<prefix2><yyyymmddHHMMss>` 不夠隨機，會撞單。
 *
 * 最終定案：`TS<yymmddHHMMss><random4>` = 2 + 12 + 4 = 18 字
 *   - 縮 yyyy → yy (今年 26)
 *   - random4 用 base36（0-9 + a-z = 36 種）→ 1.6M 種，足夠避撞
 *
 * @example
 *   genMerchantTradeNo() // 'TS260530193001A1B2'
 */
export function genMerchantTradeNo(prefix = 'TS', now: Date = new Date()): string {
  // 轉 TW 時區 (UTC+8)
  const tw = new Date(now.getTime() + 8 * 3600 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  const ts =
    String(tw.getUTCFullYear()).slice(-2) +
    pad(tw.getUTCMonth() + 1) +
    pad(tw.getUTCDate()) +
    pad(tw.getUTCHours()) +
    pad(tw.getUTCMinutes()) +
    pad(tw.getUTCSeconds())
  // 4 字英數隨機（A-Z + 0-9，36 進制）
  const rand = Array.from({ length: 4 }, () =>
    Math.floor(Math.random() * 36).toString(36).toUpperCase(),
  ).join('')
  return `${prefix}${ts}${rand}`
}

/**
 * 產生 MerchantTradeDate（綠界格式 `yyyy/MM/dd HH:mm:ss`，必須 TW 時區）
 */
export function genMerchantTradeDate(now: Date = new Date()): string {
  const tw = new Date(now.getTime() + 8 * 3600 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${tw.getUTCFullYear()}/${pad(tw.getUTCMonth() + 1)}/${pad(tw.getUTCDate())} ` +
    `${pad(tw.getUTCHours())}:${pad(tw.getUTCMinutes())}:${pad(tw.getUTCSeconds())}`
  )
}
