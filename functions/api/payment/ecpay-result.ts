/**
 * POST /api/payment/ecpay-result  (OrderResultURL)
 *
 * 綠界刷卡完成後，用戶**前景**會被 POST 回這個 URL。
 * 跟 ReturnURL 不同：這個是給「人類看的」，要回 HTML 顯示結果，不是回 "1|OK"。
 *
 * ⚠️ ⚠️ ⚠️ PHASE 2 STUB — 這份是 Phase 2 期間的最小空殼  ⚠️ ⚠️ ⚠️
 * ⚠️
 * ⚠️ 目前只做：
 * ⚠️   1. 收到 POST → 用 ECPay 給的參數渲染一個簡單 HTML 顯示結果
 * ⚠️   2. 完全沒做驗證，所以實際的 VIP 狀態以 ReturnURL（server-to-server）為準
 * ⚠️
 * ⚠️ Phase 3 / 5 要做：
 * ⚠️   - 驗 CheckMacValue
 * ⚠️   - 渲染漂亮的成功/失敗頁（接 frontend 風格）
 * ⚠️   - 提供「回首頁」按鈕跳 SPA
 */

interface Env {
  ECPAY_ENV?: string
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderPage(params: Record<string, string>): string {
  const rtnCode = params.RtnCode ?? '?'
  const rtnMsg = params.RtnMsg ?? '?'
  const mtNo = params.MerchantTradeNo ?? '?'
  const amt = params.TradeAmt ?? '?'
  const ok = rtnCode === '1'

  const rows = Object.entries(params)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px;color:#888">${escapeHtml(k)}</td>` +
        `<td style="padding:6px 12px;font-family:monospace">${escapeHtml(v)}</td></tr>`,
    )
    .join('')

  return `<!doctype html>
<html lang="zh-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>付款結果 - Phase 2 測試</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #0d1117; color: #e6edf3; margin: 0; padding: 24px; }
  .card { max-width: 720px; margin: 0 auto; background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 24px; }
  h1 { margin-top: 0; }
  .ok { color: #3fb950; }
  .fail { color: #f85149; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  table tr:nth-child(odd) { background: #0d1117; }
  .back { display: inline-block; margin-top: 16px; padding: 8px 16px; background: #1f6feb; color: #fff; text-decoration: none; border-radius: 6px; }
</style>
</head>
<body>
  <div class="card">
    <h1>付款結果 <span class="${ok ? 'ok' : 'fail'}">${ok ? '✓ 成功' : '✗ 失敗'}</span></h1>
    <p>訂單編號 <code>${escapeHtml(mtNo)}</code> / 金額 NT$${escapeHtml(amt)}</p>
    <p>RtnCode <code>${escapeHtml(rtnCode)}</code>：${escapeHtml(rtnMsg)}</p>
    <p style="color:#888;font-size:13px">
      ⚠️ Phase 2 stub — 此頁只是顯示綠界回傳的內容，沒有驗證 CheckMacValue。
      實際 VIP 狀態以 ReturnURL（server-to-server）的處理為準（Phase 3 才接 D1）。
    </p>
    <details>
      <summary style="cursor:pointer">完整 callback 參數</summary>
      <table>${rows}</table>
    </details>
    <a class="back" href="/">← 回首頁</a>
  </div>
</body>
</html>`
}

export const onRequestPost: PagesFunction<Env> = async ({ request }) => {
  let parsed: Record<string, string> = {}
  try {
    const raw = await request.text()
    const sp = new URLSearchParams(raw)
    parsed = Object.fromEntries(sp.entries())
  } catch {
    // ignore — render empty params
  }
  return new Response(renderPage(parsed), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

// GET 直接打開時顯示 placeholder
export const onRequestGet: PagesFunction<Env> = async () =>
  new Response(renderPage({}), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
