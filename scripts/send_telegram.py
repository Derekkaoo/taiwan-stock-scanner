"""
Telegram bot 發訊息 helper（給 send_notifications + screeners 用）

需 .env 設定：
  TELEGRAM_BOT_TOKEN=<your-bot-token>
  TELEGRAM_CHAT_ID=<your-chat-id>

用法：
  # 從 .env 讀 token / chat_id 自動發
  from send_telegram import send_message
  send_message("hello world")

  # 獨立測試
  python scripts/send_telegram.py "test message"
"""
import logging
import os
import sys
from pathlib import Path

import requests

logger = logging.getLogger(__name__)


def _load_env():
    """從 .env 讀 TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
    優先 os.environ，沒有的話 fallback 從 .env 檔讀。
    """
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "").strip()

    if not token or not chat_id:
        env_path = Path(__file__).parent.parent / ".env"
        if env_path.exists():
            for line in env_path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                if k == "TELEGRAM_BOT_TOKEN" and not token:
                    token = v
                elif k == "TELEGRAM_CHAT_ID" and not chat_id:
                    chat_id = v

    return token, chat_id


def send_message(text, parse_mode="HTML", disable_web_page_preview=True):
    """發訊息到 Telegram bot 綁定的 chat
    Args:
        text: 要發的訊息（最長 4096 字元）
        parse_mode: 'HTML' / 'Markdown' / None
        disable_web_page_preview: True 不展開連結預覽
    Returns:
        True 成功 / False 失敗
    """
    token, chat_id = _load_env()
    if not token or not chat_id:
        logger.error("缺 TELEGRAM_BOT_TOKEN 或 TELEGRAM_CHAT_ID（在 .env）")
        return False

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text,
        "disable_web_page_preview": disable_web_page_preview,
    }
    if parse_mode:
        payload["parse_mode"] = parse_mode

    try:
        r = requests.post(url, json=payload, timeout=10)
    except Exception as e:
        logger.error("Telegram 發送例外：%s", e)
        return False

    if not r.ok:
        logger.error("Telegram 發送失敗 (%d): %s", r.status_code, r.text[:200])
        return False

    data = r.json()
    if not data.get("ok"):
        logger.error("Telegram 回應錯誤：%s", data)
        return False

    return True


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(message)s")
    msg = sys.argv[1] if len(sys.argv) > 1 else (
        "🤖 <b>測試訊息</b>\n\n"
        "如果看到這個，<code>send_telegram.py</code> work 了！\n"
        "<i>來自 Taiwan Stock Scanner</i>"
    )
    if send_message(msg):
        print("✅ 訊息已發送")
    else:
        print("❌ 發送失敗，看上面 log")
        sys.exit(1)
