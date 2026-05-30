/**
 * POST /api/payment/ecpay-result  (綠界 OrderResultURL — 前景跳回)
 *
 * 用戶刷完卡，綠界把用戶前景 POST 過來這個 URL 看結果。
 * 跟 ReturnURL 不同：
 *   - ReturnURL  是 server-to-server，要回純文字 '1|OK'，做實際的 D1 update + 升 VIP
 *   - OrderResultURL 是給人看的，回 HTML 顯示結果，**不**做 D1 update（避免重複跟 race）
 *
 * 但 OrderResultURL 仍然要驗 CheckMacValue — 避免有人偽造 query string 騙我們渲染「成功」頁。
 */

import {
  parseEcpayCallback,
  verifyEcpayCallback,
  EcpayCallbackParams,
} from '../../_lib/ecpay-callback'

interface Env {
  DB: D1Database
  ECPAY_HASH_KEY?: string
  ECPAY_HASH_IV?: string
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function htmlResp(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

function renderSuccess(
  params: EcpayCallbackParams,
  planLabel: string,
  vipUntilSec: number | null,
): string {
  const amt = params.TradeAmt || params.amount || '?'
  const mtNo = params.MerchantTradeNo
  const tNo = params.TradeNo
  const card4 = params.card4no
  const vipUntilStr = vipUntilSec
    ? new Date(vipUntilSec * 1000).toISOString().slice(0, 10)
    : '—'

  const tNoRow = tNo
    ? `<div class="row"><span class="label">綠界交易號</span><span class="value">${escapeHtml(tNo)}</span></div>`
    : ''
  const card4Row = card4
    ? `<div class="row"><span class="label">付款卡片</span><span class="value">****${escapeHtml(card4)}</span></div>`
    : ''

  return `<!doctype html>
<html lang="zh-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>付款成功 - 台股篩選器</title>
<style>
  :root {
    --bg-800: #0d1117;
    --bg-700: #161b22;
    --border: #30363d;
    --text-primary: #e6edf3;
    --text-secondary: #8b949e;
    --accent: #58a6ff;
    --ok: #3fb950;
  }
  body { font-family: -apple-system, "Segoe UI", "PingFang TC", "Noto Sans TC", sans-serif; background: var(--bg-800); color: var(--text-primary); margin: 0; padding: 32px 16px; min-height: 100vh; box-sizing: border-box; }
  .container { max-width: 520px; margin: 0 auto; }
  .icon { font-size: 64px; color: var(--ok); text-align: center; line-height: 1; margin-bottom: 16px; }
  h1 { text-align: center; margin: 0 0 8px; font-size: 24px; }
  .sub { text-align: center; color: var(--text-secondary); font-size: 14px; margin-bottom: 32px; }
  .card { background: var(--bg-700); border: 1px solid var(--border); border-radius: 12px; padding: 20px 24px; margin-bottom: 16px; }
  .row { display: flex; justify-content: space-between; padding: 8px 0; font-size: 14px; }
  .row + .row { border-top: 1px solid var(--border); }
  .label { color: var(--text-secondary); }
  .value { color: var(--text-primary); font-family: "SF Mono", Menlo, monospace; }
  .cta { display: block; text-align: center; padding: 14px 24px; background: var(--accent); color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600; margin-top: 24px; }
  .small { text-align: center; margin-top: 16px; color: var(--text-secondary); font-size: 12px; }
</style>
</head>
<body>
<div class="container">
  <div class="icon">✓</div>
  <h1>付款成功</h1>
  <p class="sub">感謝你的訂閱，VIP 已啟用</p>
  <div class="card">
    <div class="row"><span class="label">方案</span><span class="value">${escapeHtml(planLabel)}</span></div>
    <div class="row"><span class="label">金額</span><span class="value">NT$ ${escapeHtml(amt)}</span></div>
    <div class="row"><span class="label">VIP 到期</span><span class="value">${escapeHtml(vipUntilStr)}</span></div>
    <div class="row"><span class="label">訂單編號</span><span class="value">${escapeHtml(mtNo)}</span></div>
    ${tNoRow}
    ${card4Row}
  </div>
  <a class="cta" href="/">進入會員 →</a>
  <p class="small">下次扣款時會自動續期，可在會員頁取消訂閱。</p>
</div>
</body>
</html>`
}

function renderFailure(params: EcpayCallbackParams, reason: string): string {
  const mtNo = params.MerchantTradeNo || '?'
  const msg = params.RtnMsg || reason
  return `<!doctype html>
<html lang="zh-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>付款失敗 - 台股篩選器</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #0d1117; color: #e6edf3; margin: 0; padding: 32px 16px; min-height: 100vh; box-sizing: border-box; }
  .container { max-width: 520px; margin: 0 auto; }
  .icon { font-size: 64px; color: #f85149; text-align: center; line-height: 1; margin-bottom: 16px; }
  h1 { text-align: center; margin: 0 0 8px; font-size: 24px; }
  .sub { text-align: center; color: #8b949e; font-size: 14px; margin-bottom: 24px; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 20px 24px; }
  .err-msg { color: #ffdcd7; font-size: 14px; margin-top: 8px; word-break: break-all; }
  .cta { display: block; text-align: center; padding: 14px 24px; background: #58a6ff; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600; margin-top: 16px; }
</style>
</head>
<body>
<div class="container">
  <div class="icon">✗</div>
  <h1>付款失敗</h1>
  <p class="sub">交易未完成，未扣款</p>
  <div class="card">
    <div style="color:#8b949e;font-size:12px;">訂單編號</div>
    <div style="font-family:monospace;">${escapeHtml(mtNo)}</div>
    <div class="err-msg">${escapeHtml(msg)}</div>
  </div>
  <a class="cta" href="/">回首頁</a>
</div>
</body>
</html>`
}

interface OrderLookup { plan: string; user_uid: string }
interface UserStatusLookup { vip_until: number | null }

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.ECPAY_HASH_KEY || !env.ECPAY_HASH_IV) {
    return htmlResp('<h1>Server not configured</h1><p>Missing ECPay keys.</p>', 500)
  }

  const parsed = await parseEcpayCallback(request)
  if (!parsed) {
    return htmlResp('<h1>無效的請求</h1><p>付款參數解析失敗，請從首頁重新發起訂閱。</p><a href="/">回首頁</a>', 400)
  }
  const { params } = parsed

  const valid = await verifyEcpayCallback(params, env.ECPAY_HASH_KEY, env.ECPAY_HASH_IV)
  if (!valid) {
    console.warn(`[ecpay-result] CheckMacValue verification failed for MerchantTradeNo=${params.MerchantTradeNo}`)
    return htmlResp('<h1>驗證失敗</h1><p>付款資訊簽章驗證失敗，請聯絡客服。</p><a href="/">回首頁</a>', 400)
  }

  if (params.RtnCode !== '1') {
    return htmlResp(renderFailure(params, '扣款未成功'))
  }

  let planLabel = '訂閱方案'
  let vipUntil: number | null = null
  try {
    const order = await env.DB
      .prepare('SELECT plan, user_uid FROM orders WHERE merchant_trade_no = ? LIMIT 1')
      .bind(params.MerchantTradeNo)
      .first<OrderLookup>()
    if (order) {
      planLabel = order.plan === 'yearly' ? '年付方案' : '月付方案'
      const status = await env.DB
        .prepare('SELECT vip_until FROM user_status WHERE uid = ? LIMIT 1')
        .bind(order.user_uid)
        .first<UserStatusLookup>()
      vipUntil = status?.vip_until ?? null
    }
  } catch (e) {
    console.warn('[ecpay-result] failed to enrich order:', e)
  }

  return htmlResp(renderSuccess(params, planLabel, vipUntil))
}

export const onRequestGet: PagesFunction<Env> = async () =>
  htmlResp(
    `<!doctype html><html><body style="font-family:sans-serif;padding:24px;background:#0d1117;color:#e6edf3;">
       <h1>付款結果頁</h1>
       <p>此頁面由綠界扣款完成後自動跳轉。如果你是直接打開此網址，請從<a href="/" style="color:#58a6ff">首頁</a>進入。</p>
     </body></html>`,
  )
