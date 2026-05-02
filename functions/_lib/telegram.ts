/**
 * Telegram Bot API helper（Cloudflare Pages Function 用）
 *
 * 重點：
 * - send_admin_message vs send_user_message 在 Python 那邊區分；這支 module 只負責「對指定 chat 發訊息」
 * - 所有訊息都是 targeted，沒有任何 broadcast 邏輯
 * - bind code 用 6 位英數字（不含易混淆的 0/O/1/I）
 */

const TG_API = (token: string, method: string) =>
  `https://api.telegram.org/bot${token}/${method}`

/** 6 位英數字 code（去掉容易混淆的 0/O/1/I） */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function generateBindCode(): string {
  let s = ''
  for (let i = 0; i < 6; i++) {
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  }
  return s
}

export interface TelegramSendResult {
  ok: boolean
  status: number
  description?: string
}

/**
 * 對指定 chat_id 發送訊息（HTML 格式）
 * 包 try/catch，失敗回 {ok:false} 而不 throw — 給 webhook / push 流程用
 */
export async function sendMessage(
  botToken: string,
  chatId: string,
  text: string,
  parseMode: 'HTML' | 'MarkdownV2' | 'Markdown' = 'HTML',
): Promise<TelegramSendResult> {
  try {
    const r = await fetch(TG_API(botToken, 'sendMessage'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: true,
      }),
    })
    const j = (await r.json()) as { ok: boolean; description?: string }
    if (!j.ok) {
      console.error(
        `[sendMessage] FAILED chat=${chatId} status=${r.status} desc=${j.description ?? ''}`,
      )
    } else {
      console.log(`[sendMessage] sent to chat=${chatId} status=${r.status}`)
    }
    return { ok: j.ok === true, status: r.status, description: j.description }
  } catch (e) {
    console.error(
      `[sendMessage] EXCEPTION chat=${chatId} err=${e instanceof Error ? e.message : String(e)}`,
    )
    return { ok: false, status: 0, description: e instanceof Error ? e.message : String(e) }
  }
}

/** 把 HTML 特殊字元 escape 成 Telegram HTML 安全字串 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
