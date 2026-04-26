"""
runner.py — 跑全部 screener 策略 + 發 Telegram

執行順序：
  1. load stocks.json + twii.json
  2. 跑每個註冊的策略
  3. 組訊息（HTML format）
  4. 推到 Telegram

用法：
  python -m scripts.screeners.runner
  或 cd scripts && python -m screeners.runner
"""
from __future__ import annotations
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
#  主流程
# ============================================================
def run() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

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

    ok = send_message(message)
    if ok:
        logger.info("Telegram 推送成功")
        return 0
    else:
        logger.error("Telegram 推送失敗")
        return 2


if __name__ == "__main__":
    sys.exit(run())
