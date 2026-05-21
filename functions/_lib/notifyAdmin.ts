/**
 * 推 Telegram 到 admin（你自己）
 *
 * 用既有的 TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID secrets（雲端 cron 已在用）。
 * 失敗時靜默（log 但不丟錯，避免影響正常 endpoint 流程）。
 *
 * 用法：
 *   import { notifyAdmin } from '../_lib/notifyAdmin'
 *   await notifyAdmin(env, '🎯 新策略儲存\n...')
 */
import { sendMessage } from './telegram'

interface NotifyEnv {
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_CHAT_ID?: string
}

/** 取 user_token 前 8 碼當匿名 ID（譬如 google:abc123def... → abc123de）*/
export function anonId(userToken: string): string {
  const after = userToken.startsWith('google:') ? userToken.slice(7) : userToken
  return after.slice(0, 8)
}

export async function notifyAdmin(env: NotifyEnv, text: string): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN
  const chatId = env.TELEGRAM_CHAT_ID
  if (!token || !chatId) {
    console.warn('[notifyAdmin] no TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID, skipping')
    return
  }
  try {
    await sendMessage(token, chatId, text)
  } catch (e) {
    console.warn(
      `[notifyAdmin] failed: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
}
