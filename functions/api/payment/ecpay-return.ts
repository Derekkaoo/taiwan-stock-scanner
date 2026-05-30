/**
 * POST /api/payment/ecpay-return  (ReturnURL)
 *
 * 綠界背景 server-to-server callback。首期扣款成功 + 每月續期都會打進來。
 *
 * ⚠️ ⚠️ ⚠️ PHASE 2 STUB — 這份是 Phase 2 期間的最小空殼  ⚠️ ⚠️ ⚠️
 * ⚠️
 * ⚠️ 目前只做：
 * ⚠️   1. 紀錄 raw payload 到 stderr (Cloudflare log)
 * ⚠️   2. 回 "1|OK" 給綠界 (避免它重打)
 * ⚠️
 * ⚠️ 不做：
 * ⚠️   - 驗 CheckMacValue（重要！沒驗任何人都能 forge 升 VIP）
 * ⚠️   - 寫 D1 payments / orders
 * ⚠️   - 升級 user_status 為 VIP
 * ⚠️
 * ⚠️ 安全防護：
 * ⚠️   ECPAY_ENV=production 時直接 refuse，避免 Phase 3 沒做就上線會被打。
 * ⚠️
 * ⚠️ Phase 3 必做事項：
 * ⚠️   - verifyEcpay(params, hashKey, hashIV) → 不過直接 403
 * ⚠️   - idempotent INSERT INTO payments
 * ⚠️   - UPDATE orders SET status='paid', paid_at=now, gwsr=..., card4no=...
 * ⚠️   - UPDATE user_status SET tier='VIP', vip_until=+1月/+1年
 * ⚠️   - 第一次成功 → notifyAdmin Telegram「新訂閱」
 */

interface Env {
  DB: D1Database
  ECPAY_ENV?: string
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // 1. Production 拒絕（Phase 3 才會打開）
  if (env.ECPAY_ENV === 'production') {
    return new Response('0|PhaseNotImplemented', { status: 500 })
  }

  // 2. 拿 form-urlencoded payload
  let raw = ''
  let parsed: Record<string, string> = {}
  try {
    raw = await request.text()
    const sp = new URLSearchParams(raw)
    parsed = Object.fromEntries(sp.entries())
  } catch {
    // 不影響回 OK，照樣讓綠界覺得成功（測試環境）
  }

  // 3. log（方便 Phase 2 期間用 wrangler tail 看）
  console.log('[ecpay-return STUB]', JSON.stringify(parsed, null, 2))
  console.log('[ecpay-return STUB raw]', raw)

  // 4. 綠界要求成功回 "1|OK"（注意：是純文字，不是 JSON）
  return new Response('1|OK', {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  })
}

// 健康檢查（不接受 GET 但避免 404）
export const onRequestGet: PagesFunction<Env> = async () =>
  new Response('ecpay-return endpoint (POST only)', { status: 405 })
