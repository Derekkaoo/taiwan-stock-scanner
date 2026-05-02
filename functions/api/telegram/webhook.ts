/**
 * POST /api/telegram/webhook
 *
 * Telegram Bot 會把收到的訊息 forward 過來。我們處理：
 *   /start               → 歡迎訊息 + 教使用者怎麼綁定
 *   /bind <code>         → 驗證 code → 寫 telegram_bindings → 回確認
 *   /unbind              → 解除綁定（從 chat 端解，跟前端 DELETE 等效）
 *   /status              → 顯示當前綁定狀態
 *   其他 / 任何訊息       → 提示去網站完成綁定
 *
 * 安全：
 *   Telegram setWebhook 時可以設 secret_token，那個 token 會被 Telegram 放在
 *   X-Telegram-Bot-Api-Secret-Token header，我們對照 env.TELEGRAM_WEBHOOK_SECRET 驗證。
 *
 * 設計：
 *   失敗永遠回 200 + ok:true，避免 Telegram 重送同樣訊息（造成重複綁定 / 騷擾使用者）
 *   錯誤訊息直接 sendMessage 給使用者，不從這個 endpoint 回 4xx/5xx
 */

import { sendMessage, escapeHtml } from '../../_lib/telegram'

interface Env {
  DB: D1Database
  TELEGRAM_BOT_TOKEN: string
  TELEGRAM_WEBHOOK_SECRET?: string
}

interface TelegramUser {
  id: number
  is_bot?: boolean
  first_name?: string
  last_name?: string
  username?: string
  language_code?: string
}

interface TelegramChat {
  id: number
  type: 'private' | 'group' | 'supergroup' | 'channel'
  username?: string
  first_name?: string
  last_name?: string
}

interface TelegramMessage {
  message_id: number
  from?: TelegramUser
  chat: TelegramChat
  date: number
  text?: string
}

interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
}

interface BindCodeRow {
  code: string
  user_uid: string
  user_email: string | null
  expires_at: number
  created_at: number
}

function ok() {
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
}

/** 嘗試從 message text 解析指令 + 參數 */
function parseCommand(text: string): { cmd: string; args: string } {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return { cmd: '', args: '' }
  const space = trimmed.indexOf(' ')
  if (space < 0) {
    // 處理 /command@bot_username 的形式（group chat 才會這樣）
    const at = trimmed.indexOf('@')
    return { cmd: at > 0 ? trimmed.slice(1, at).toLowerCase() : trimmed.slice(1).toLowerCase(), args: '' }
  }
  const cmdPart = trimmed.slice(1, space)
  const at = cmdPart.indexOf('@')
  const cmd = (at > 0 ? cmdPart.slice(0, at) : cmdPart).toLowerCase()
  const args = trimmed.slice(space + 1).trim()
  return { cmd, args }
}

async function handleBind(
  env: Env,
  msg: TelegramMessage,
  args: string,
): Promise<void> {
  const chatId = String(msg.chat.id)
  const code = args.toUpperCase().trim()

  if (!code) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      '請輸入綁定碼，格式：<code>/bind ABC123</code>\n\n如果還沒拿到綁定碼，請到網站「設定 → Telegram 推播」點「綁定」按鈕。',
    )
    return
  }

  // 查 code
  const row = await env.DB
    .prepare(
      'SELECT code, user_uid, user_email, expires_at FROM telegram_bind_codes WHERE code = ?',
    )
    .bind(code)
    .first<BindCodeRow>()

  if (!row) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      '❌ 綁定碼無效或不存在。\n\n請到網站重新產生綁定碼。',
    )
    return
  }

  if (row.expires_at < Date.now()) {
    await env.DB
      .prepare('DELETE FROM telegram_bind_codes WHERE code = ?')
      .bind(code)
      .run()
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      '❌ 綁定碼已過期（10 分鐘有效期）。\n\n請到網站重新產生。',
    )
    return
  }

  // 過所有驗證 → 寫綁定（INSERT OR REPLACE 保證一個 user 只一筆）
  const username = msg.from?.username || msg.chat.username || null
  const firstName = msg.from?.first_name || msg.chat.first_name || null

  try {
    await env.DB
      .prepare(
        `INSERT INTO telegram_bindings
         (user_uid, user_email, chat_id, username, first_name, bound_at)
         VALUES (?, ?, ?, ?, ?, CAST(strftime('%s', 'now') AS INTEGER))
         ON CONFLICT(user_uid) DO UPDATE SET
           user_email = excluded.user_email,
           chat_id    = excluded.chat_id,
           username   = excluded.username,
           first_name = excluded.first_name,
           bound_at   = excluded.bound_at`,
      )
      .bind(row.user_uid, row.user_email, chatId, username, firstName)
      .run()
  } catch (e) {
    // chat_id UNIQUE 撞了 — 這個 chat 已經綁給別人
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      '❌ 這個 Telegram 帳號已綁定其他網站帳號。\n\n如果你想換綁，請先在原帳號上解除綁定。',
    )
    return
  }

  // 用過的 code 立即刪掉
  await env.DB
    .prepare('DELETE FROM telegram_bind_codes WHERE code = ?')
    .bind(code)
    .run()

  const displayName = firstName || username || `chat ${chatId}`
  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    chatId,
    `✅ 綁定成功！\n\n` +
      `Hello <b>${escapeHtml(displayName)}</b>，未來每天 19:00（週一到週五）會自動推播你的選股策略結果。\n\n` +
      `📋 指令清單：\n` +
      `<code>/status</code> — 查看綁定資訊\n` +
      `<code>/unbind</code> — 解除綁定`,
  )
}

async function handleUnbind(env: Env, msg: TelegramMessage): Promise<void> {
  const chatId = String(msg.chat.id)
  const result = await env.DB
    .prepare('DELETE FROM telegram_bindings WHERE chat_id = ?')
    .bind(chatId)
    .run()

  if (result.meta.changes && result.meta.changes > 0) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      '✅ 已解除綁定。\n\n如要重新綁定，請到網站重新走流程。',
    )
  } else {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      '此 Telegram 帳號未綁定任何網站帳號。',
    )
  }
}

async function handleStatus(env: Env, msg: TelegramMessage): Promise<void> {
  const chatId = String(msg.chat.id)
  const row = await env.DB
    .prepare(
      'SELECT user_email, username, first_name, bound_at, last_push_at FROM telegram_bindings WHERE chat_id = ?',
    )
    .bind(chatId)
    .first<{
      user_email: string | null
      username: string | null
      first_name: string | null
      bound_at: number
      last_push_at: number | null
    }>()

  if (!row) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      '此 Telegram 帳號未綁定。\n\n請到網站「設定 → Telegram 推播」開始綁定。',
    )
    return
  }

  const boundDate = new Date(row.bound_at * 1000).toISOString().slice(0, 10)
  const lastPush = row.last_push_at
    ? new Date(row.last_push_at * 1000).toISOString().slice(0, 10)
    : '尚未推播'

  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    chatId,
    `📋 綁定狀態：\n\n` +
      `帳號 Email：<code>${escapeHtml(row.user_email || '—')}</code>\n` +
      `綁定日期：<code>${boundDate}</code>\n` +
      `上次推播：<code>${lastPush}</code>\n\n` +
      `下次推播時間：今晚 19:00（週一到週五）`,
  )
}

async function handleStart(env: Env, msg: TelegramMessage, args: string): Promise<void> {
  // Telegram deeplink `https://t.me/<bot>?start=<code>` 會把 code 當作 /start 的參數
  // 帶進來。如果 args 看起來像個 bind code，直接走 bind 流程，使用者就一鍵完成綁定。
  if (args.trim()) {
    await handleBind(env, msg, args)
    return
  }

  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    String(msg.chat.id),
    `👋 歡迎使用 <b>千張大戶持股追蹤器</b>！\n\n` +
      `這支 bot 會在每天 19:00 推播你儲存的選股策略命中結果。\n\n` +
      `🔗 開始：到 <a href="https://taiwan-stock-scanner.pages.dev">網站</a> 登入 Google → 設定 → Telegram 推播 → 點「綁定」按鈕（一鍵帶你回來），或手動輸入：\n\n` +
      `<code>/bind ABC123</code>\n\n` +
      `📋 指令清單：\n` +
      `<code>/bind &lt;code&gt;</code> — 綁定帳號\n` +
      `<code>/status</code> — 查看綁定資訊\n` +
      `<code>/unbind</code> — 解除綁定`,
  )
}

async function handleUnknown(env: Env, msg: TelegramMessage): Promise<void> {
  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    String(msg.chat.id),
    '請使用以下指令：\n' +
      `<code>/start</code> — 說明\n` +
      `<code>/bind &lt;code&gt;</code> — 綁定帳號\n` +
      `<code>/status</code> — 查看綁定資訊\n` +
      `<code>/unbind</code> — 解除綁定`,
  )
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  console.log('[webhook] received POST')

  // 1. 驗證 secret token（如果有設定）
  if (env.TELEGRAM_WEBHOOK_SECRET) {
    const incoming = request.headers.get('X-Telegram-Bot-Api-Secret-Token')
    const expected = env.TELEGRAM_WEBHOOK_SECRET
    const incomingLen = incoming?.length ?? 0
    const expectedLen = expected.length
    if (incoming !== expected) {
      console.error(
        `[webhook] secret mismatch! incomingLen=${incomingLen} expectedLen=${expectedLen} ` +
          `incomingHead=${incoming?.slice(0, 4) ?? 'null'} expectedHead=${expected.slice(0, 4)}`,
      )
      return ok()
    }
    console.log('[webhook] secret matched')
  } else {
    console.warn('[webhook] no TELEGRAM_WEBHOOK_SECRET configured — skipping secret check')
  }

  if (!env.TELEGRAM_BOT_TOKEN) {
    console.error('[webhook] TELEGRAM_BOT_TOKEN missing in env!')
    return ok()
  }
  console.log(`[webhook] bot token loaded (length=${env.TELEGRAM_BOT_TOKEN.length})`)

  // 2. 解析 update
  let update: TelegramUpdate
  try {
    update = await request.json()
  } catch (e) {
    console.error('[webhook] failed to parse JSON:', e)
    return ok()
  }

  const msg = update.message
  if (!msg || !msg.text) {
    console.log('[webhook] update has no message.text — ignored')
    return ok()
  }

  console.log(
    `[webhook] message from chat=${msg.chat.id} type=${msg.chat.type} text=${JSON.stringify(msg.text.slice(0, 50))}`,
  )

  // 群組 / 頻道訊息忽略 — 這個 bot 設計只接受私訊綁定
  if (msg.chat.type !== 'private') {
    const r = await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      String(msg.chat.id),
      '請以私訊的方式跟 bot 對話，群組綁定不支援。',
    )
    console.log(`[webhook] sent group-warning, ok=${r.ok} status=${r.status} desc=${r.description ?? ''}`)
    return ok()
  }

  const { cmd, args } = parseCommand(msg.text)
  console.log(`[webhook] cmd=${cmd} args=${JSON.stringify(args)}`)

  try {
    switch (cmd) {
      case 'start':
        await handleStart(env, msg, args)
        break
      case 'bind':
        await handleBind(env, msg, args)
        break
      case 'unbind':
        await handleUnbind(env, msg)
        break
      case 'status':
        await handleStatus(env, msg)
        break
      default:
        await handleUnknown(env, msg)
    }
    console.log(`[webhook] handler ${cmd} done`)
  } catch (e) {
    // 任何未預期錯誤 — 寫 log，但回 200 讓 Telegram 不重送
    console.error('[webhook] handler error:', e)
  }

  return ok()
}
