"""
Telegram 推播 helper（給 screeners / 其他通知用）

需 .env 設定：
  TELEGRAM_BOT_TOKEN=<your-bot-token>
  TELEGRAM_CHAT_ID=<your-chat-id>

用法：
  from send_telegram import send_message
  send_message("hello")
"""
import os
import logging
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

# 讀 .env
ENV_PATH = Path(__file__).parent.parent / ".env"
if ENV_PATH.exists():
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


def send_message(text, parse_mode="HTML", disable_preview=True):
    """發訊息到 Telegram。回傳 True 成功 / False 失敗。"""
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    if not token or not chat_id:
        logger.error("缺 TELEGRAM_BOT_TOKEN 或 TELEGRAM_CHAT_ID（檢查 .env）")
        return False

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": parse_mode,
        "disable_web_page_preview": disable_preview,
    }
    try:
        r = requests.post(url, data=payload, timeout=15)
        if r.status_code != 200:
            logger.error("Telegram 回 %d：%s", r.status_code, r.text[:200])
            return False
        return True
    except Exception as e:
        logger.error("Telegram 推送失敗：%s", e)
        return False


if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    msg = " ".join(sys.argv[1:]) or "test from send_telegram.py"
    ok = send_message(msg)
    print("OK" if ok else "FAIL")
