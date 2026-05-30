/**
 * POST /api/payment/create-order
 *
 * 用 Google ID Token 驗證 user → 在 D1 orders 表建一筆 pending 訂單
 * → 算綠界 CheckMacValue → 回傳完整 form 欄位給前端 auto-submit。
 *
 * Request body:
 *   { "plan": "monthly" | "yearly" }
 *
 * Response 200:
 *   {
 *     "merchantTradeNo": "TS2605301930ABCD",
 *     "ecpayUrl":        "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5",
 *     "formFields":      { MerchantID, MerchantTradeNo, ..., CheckMacValue }
 *   }
 *
 * 前端拿到後做：
 *   const form = document.createElement('form')
 *   form.method = 'POST'
 *   form.action = res.ecpayUrl
 *   Object.entries(res.formFields).forEach(([k, v]) => {
 *     const i = document.createElement('input')
 *     i.type = 'hidden'; i.name = k; i.value = String(v); form.appendChild(i)
 *   })
 *   document.body.appendChild(form)
 *   form.submit()
 *
 * 環境變數（Cloudflare Pages env）：
 *   ECPAY_ENV          'stage' | 'production'
 *   ECPAY_MERCHANT_ID  商店代號
 *   ECPAY_HASH_KEY     HashKey
 *   ECPAY_HASH_IV      HashIV
 *   GOOGLE_CLIENT_ID   用來驗 ID Token
 */

import { authenticateRequest } from '../../_lib/google-auth'
import {
  EcpayEnv,
  genMerchantTradeDate,
  genMerchantTradeNo,
  getEcpayEndpoint,
  signEcpay,
} from '../../_lib/ecpay'

interface Env {
  DB: D1Database
  GOOGLE_CLIENT_ID: string
  ECPAY_ENV?: string
  ECPAY_MERCHANT_ID?: string
  ECPAY_HASH_KEY?: string
  ECPAY_HASH_IV?: string
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

// ───────────────────────────────────────────────────────────
// 方案定義（單一真相來源 — 改價格只動這裡）
// ───────────────────────────────────────────────────────────

type PlanKey = 'monthly' | 'yearly'

interface PlanConfig {
  amount: number          // 每期金額（首期 = 續期，都一樣）
  periodType: 'M' | 'Y'   // 綠界 PeriodType
  frequency: number       // 每 N 個 PeriodType 扣一次（我們固定 1）
  execTimes: number       // 綠界 ExecTimes（M 最大 99，Y 最大 9，用最大化長期訂閱）
  tradeDesc: string       // 綠界 TradeDesc（避中文/特殊符號減少 encoding 問題）
  itemName: string        // 綠界 ItemName
}

const PLANS: Record<PlanKey, PlanConfig> = {
  monthly: {
    amount: 88,
    periodType: 'M',
    frequency: 1,
    execTimes: 99,
    tradeDesc: 'TaiwanStockScanner Monthly Subscription',
    itemName: 'TaiwanStockScanner VIP - Monthly',
  },
  yearly: {
    amount: 888,
    periodType: 'Y',
    frequency: 1,
    execTimes: 9,
    tradeDesc: 'TaiwanStockScanner Yearly Subscription',
    itemName: 'TaiwanStockScanner VIP - Yearly',
  },
}

// ───────────────────────────────────────────────────────────
// Endpoint
// ───────────────────────────────────────────────────────────

export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, { status: 204, headers: CORS_HEADERS })

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // 1. 檢查環境變數
  if (!env.GOOGLE_CLIENT_ID) {
    return jsonResponse({ error: 'Server missing GOOGLE_CLIENT_ID' }, 500)
  }
  if (!env.ECPAY_MERCHANT_ID || !env.ECPAY_HASH_KEY || !env.ECPAY_HASH_IV) {
    return jsonResponse(
      { error: 'Server missing ECPAY_MERCHANT_ID / ECPAY_HASH_KEY / ECPAY_HASH_IV' },
      500,
    )
  }
  const ecpayEnv: EcpayEnv = env.ECPAY_ENV === 'production' ? 'production' : 'stage'

  // 2. 驗 Google ID Token
  let user
  try {
    user = await authenticateRequest(request, env.GOOGLE_CLIENT_ID)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Auth failed'
    return jsonResponse({ error: msg }, 401)
  }

  // 3. 解析 body
  let body: { plan?: unknown }
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400)
  }
  if (body.plan !== 'monthly' && body.plan !== 'yearly') {
    return jsonResponse({ error: "plan must be 'monthly' or 'yearly'" }, 400)
  }
  const plan: PlanKey = body.plan
  const cfg = PLANS[plan]

  // 4. 算公開 URL（用 request.url 抓 origin → 自動匹配 stage / preview / production deploy）
  const origin = new URL(request.url).origin
  const returnURL = `${origin}/api/payment/ecpay-return`
  const orderResultURL = `${origin}/api/payment/ecpay-result`
  const clientBackURL = `${origin}/`

  // 5. 生 MerchantTradeNo 跟 MerchantTradeDate
  const merchantTradeNo = genMerchantTradeNo('TS')
  const merchantTradeDate = genMerchantTradeDate()

  // 6. 在 D1 建 pending order（先建單再算 CheckMacValue，這樣即使送出後 ECPay reject，
  //     我們 D1 也有紀錄可以對帳）
  const now = Math.floor(Date.now() / 1000)
  try {
    await env.DB
      .prepare(
        `INSERT INTO orders
           (merchant_trade_no, user_uid, user_email, plan, amount,
            period_type, period_frequency, period_times, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      )
      .bind(
        merchantTradeNo,
        user.sub,
        user.email ?? null,
        plan,
        cfg.amount,
        cfg.periodType,
        cfg.frequency,
        cfg.execTimes,
        now,
      )
      .run()
  } catch (e) {
    // 罕見：可能撞到主鍵衝突（同一秒同個 random4），讓 user 重試
    const msg = e instanceof Error ? e.message : String(e)
    return jsonResponse({ error: `Failed to create order: ${msg}` }, 500)
  }

  // 7. 組綠界 AIO 信用卡定期定額 form 欄位
  //    （順序不重要，signEcpay 會自己按 key 排序）
  const formFields: Record<string, string | number> = {
    MerchantID: env.ECPAY_MERCHANT_ID,
    MerchantTradeNo: merchantTradeNo,
    MerchantTradeDate: merchantTradeDate,
    PaymentType: 'aio',
    TotalAmount: cfg.amount,
    TradeDesc: cfg.tradeDesc,
    ItemName: cfg.itemName,
    ReturnURL: returnURL,
    ChoosePayment: 'Credit',
    EncryptType: 1,
    // 信用卡定期定額專屬
    PeriodAmount: cfg.amount,
    PeriodType: cfg.periodType,
    Frequency: cfg.frequency,
    ExecTimes: cfg.execTimes,
    PeriodReturnURL: returnURL,
    // 前景跳回（user 看的）
    OrderResultURL: orderResultURL,
    ClientBackURL: clientBackURL,
    // 多回傳卡片資訊（card4no / gwsr 給後續廢止授權用）
    NeedExtraPaidInfo: 'Y',
  }

  // 8. 算 CheckMacValue（必須最後算）
  const checkMacValue = await signEcpay(
    formFields,
    env.ECPAY_HASH_KEY,
    env.ECPAY_HASH_IV,
  )
  formFields.CheckMacValue = checkMacValue

  // 9. 回傳給前端 auto-submit
  return jsonResponse({
    merchantTradeNo,
    ecpayUrl: getEcpayEndpoint(ecpayEnv, 'aio'),
    formFields,
  })
}
