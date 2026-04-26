"""
runner.py — 跑全部 screener 策略 + 發 Telegram

執行順序：
  1. load stocks.json + twii.json
  2. 跑每個註冊的策略
  3. 組訊息（HTML format）
  4. 推到 Telegram（同日同樣內容會 skip，避免重複推送）

CLI flags:
  --skip-telegram     完全不推 Telegram（只算 + 印 console）
  --force-telegram    強制推（無視同日重複檢查）

用法：
  python -m scripts.screeners.runner
"""
from __future__ import annotations
import hashlib
import json
import logging
import sys
from datetime import datetime
from pathlib import Path

# Windows console 預設 cp950 吃不下 emoji；強制 UTF-8 + errors=replace 避免 print 爆掉
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

# 讓 `python scripts/screeners/runner.py` 也能跑（補 sys.path）
ROOT = Path(__file__).parent.parent.parent
if str(ROOT / "scripts") not in sys.path:
    sys.path.insert(0, str(ROOT / "scripts"))

from screeners.base import Strategy, ScreenerHit, load_stocks, MarketContext
from screeners.strategy1 import Strategy1
from screeners.strategy2 import Strategy2
from send_telegram import send_message

logger = logging.getLogger(__name__)

# 同日重複推送的去重 cache
TELEGRAM_CACHE_PATH = ROOT / "backend" / "db" / "last_telegram_push.json"


# ============================================================
#  策略註冊（未來新增策略加在這個 list）
# ============================================================
STRATEGIES: list[Strategy] = [
    Strategy1(),
    Strategy2(),
]


# ============================================================
#  訊息組裝
# ============================================================
def html_escape(s: str) -> str:
    return (s.replace("&", "&amp;")
             .replace("<", "&lt;")
             .replace(">", "&gt;"))


def format_market_line(market: MarketContext) -> str:
    if market.regime == "unknown":
        return "⚙️ 大盤狀態：(未取得 TWII 資料)"
    arrow = "↑" if market.regime == "bull" else "↓"
    bear_or_bull = "多頭" if market.regime == "bull" else "空頭"
    return (
        f"⚙️ 大盤 {bear_or_bull} {arrow}（"
        f"20MA {market.twii_ma20} {'>' if market.regime=='bull' else '≤'} 60MA {market.twii_ma60}）"
    )


def build_message(
    market: MarketContext,
    results: list[tuple[Strategy, list[ScreenerHit]]],
) -> str:
    today = datetime.now().strftime("%Y-%m-%d")
    lines = [f"📊 <b>每日選股報告 {today}</b>", ""]

    any_hits = False
    for strategy, hits in results:
        lines.append(f"🎯 <b>{html_escape(strategy.name)}</b>（符合 {len(hits)} 支）")
        if not hits:
            lines.append("  <i>無符合股票</i>")
        else:
            any_hits = True
            for h in hits[:30]:   # 最多列 30 支，避免訊息過長
                line = f"  <code>{h.stock_id}</code> {html_escape(h.name)}"
                if h.reasons:
                    line += f"\n    └─ {html_escape(' | '.join(h.reasons))}"
                lines.append(line)
            if len(hits) > 30:
                lines.append(f"  <i>... 還有 {len(hits) - 30} 支未顯示</i>")
        lines.append("")

    lines.append("─────────────")
    lines.append(format_market_line(market))

    if not any_hits:
        lines.insert(2, "<i>今日無策略命中</i>")
        lines.insert(3, "")

    return "\n".join(lines)


# ============================================================
#  Telegram 去重 cache
# ============================================================
def _content_hash(message: str) -> str:
    """訊息內容 hash（去掉時間戳前綴後再 hash，避免日期不同就差異）"""
    # 把開頭的「📊 每日選股報告 YYYY-MM-DD」那行拿掉再 hash
    body = "\n".join(message.split("\n")[1:])
    return hashlib.md5(body.encode("utf-8")).hexdigest()[:16]


def _should_send_telegram(message: str) -> tuple[bool, str]:
    """檢查今日是否已推過相同內容。回傳 (要推?, 理由說明)"""
    today = datetime.now().strftime("%Y-%m-%d")
    new_hash = _content_hash(message)

    if not TELEGRAM_CACHE_PATH.exists():
        return True, "首次推送（cache 不存在）"

    try:
        cache = json.loads(TELEGRAM_CACHE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return True, "cache 讀取失敗，視為首次"

    last_date = cache.get("date", "")
    last_hash = cache.get("hash", "")

    if last_date != today:
        return True, f"新的一天（上次 {last_date}）"
    if last_hash != new_hash:
        return True, "今日內容變動（重新推送）"
    return False, f"今日已推過相同內容（hash {last_hash}）"


def _save_telegram_cache(message: str):
    today = datetime.now().strftime("%Y-%m-%d")
    cache = {
        "date": today,
        "hash": _content_hash(message),
        "pushed_at": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
    }
    TELEGRAM_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    TELEGRAM_CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")


# ============================================================
#  主流程
# ============================================================
def run() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

    skip_telegram  = "--skip-telegram"  in sys.argv
    force_telegram = "--force-telegram" in sys.argv

    stocks = load_stocks()
    if not stocks:
        logger.error("無 stocks 資料，中止")
        return 1
    logger.info("載入 %d 支股票", len(stocks))

    market = MarketContext.from_twii_json()
    logger.info("大盤：%s（close=%s, 20MA=%s, 60MA=%s）",
                market.regime, market.twii_close, market.twii_ma20, market.twii_ma60)

    results: list[tuple[Strategy, list[ScreenerHit]]] = []
    for strategy in STRATEGIES:
        hits = strategy.evaluate(stocks, market)
        logger.info("%s → %d 支命中", strategy.name, len(hits))
        results.append((strategy, hits))

    message = build_message(market, results)
    print("\n" + "=" * 60)
    print(message)
    print("=" * 60 + "\n")

    if skip_telegram:
        logger.info("--skip-telegram 指定，不推送")
        return 0

    if not force_telegram:
        should_send, reason = _should_send_telegram(message)
        if not should_send:
            logger.info("Telegram 跳過：%s", reason)
            return 0
        logger.info("Telegram 將推送：%s", reason)

    ok = send_message(message)
    if ok:
        logger.info("Telegram 推送成功")
        _save_telegram_cache(message)
        return 0
    else:
        logger.error("Telegram 推送失敗")
        return 2


if __name__ == "__main__":
    sys.exit(run())
