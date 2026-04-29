"""
scrape_market.py — 為每支股票抓上市/上櫃，寫進 stocks.json 的 market 欄位

從 Yahoo TW finance 抓 `exchangeName`：
  https://tw.stock.yahoo.com/quote/{id}.{TW|TWO}/institutional-trading
  inline JSON 裡有 "exchangeName":"上市" 或 "上櫃"

特性：
- smart-skip：已有 market 欄位的股票跳過（不重抓）
- --force：強制重抓所有股票
- 自動偵測 .TW (上市) / .TWO (上櫃) suffix
- throttle 0.3 秒/支，避免 Yahoo 反爬

用法：
  python scripts/scrape_market.py            # 增量補齊缺 market 的
  python scripts/scrape_market.py --force    # 全部重抓（新上市股下市股建議跑這個）
"""
from __future__ import annotations
import json
import logging
import re
import sys
import time
from collections import Counter
from pathlib import Path

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent.parent / "frontend" / "public" / "data"
USER_AGENT = "Mozilla/5.0"

YAHOO_URL = "https://tw.stock.yahoo.com/quote/{stock_id}.{suffix}/institutional-trading"


def fetch_yahoo_market(stock_id: str) -> str | None:
    """抓 Yahoo 看 exchangeName。回傳 '上市' / '上櫃' / None。
    自動試 .TW 跟 .TWO。"""
    for suffix in ("TW", "TWO"):
        url = YAHOO_URL.format(stock_id=stock_id, suffix=suffix)
        try:
            r = requests.get(url, timeout=30, headers={"User-Agent": USER_AGENT})
            if r.status_code != 200:
                continue
            html = r.text
            m = re.search(r'"exchangeName":"(上市|上櫃)"', html)
            if m:
                return m.group(1)
        except Exception as e:
            logger.debug("Yahoo [%s.%s] 例外: %s", stock_id, suffix, e)
    return None


def run() -> int:
    force = "--force" in sys.argv
    stocks_path = DATA_DIR / "stocks.json"
    if not stocks_path.exists():
        logger.error("stocks.json 不存在")
        return 1

    stocks = json.loads(stocks_path.read_text(encoding="utf-8"))
    logger.info("共 %d 支股票（force=%s）", len(stocks), force)

    fetched = 0
    skipped = 0
    failed = 0
    failed_ids = []

    for i, s in enumerate(stocks, 1):
        sid = s.get("id")
        if not sid:
            continue

        if not force and s.get("market"):
            skipped += 1
            continue

        market = fetch_yahoo_market(sid)
        if market:
            s["market"] = market
            fetched += 1
        else:
            failed += 1
            failed_ids.append(sid)

        time.sleep(0.3)  # 節流避免 Yahoo 反爬
        if i % 30 == 0:
            logger.info("進度 %d/%d（抓 %d / 跳過 %d / 失敗 %d）",
                        i, len(stocks), fetched, skipped, failed)

    # 寫回 stocks.json
    with open(stocks_path, "w", encoding="utf-8") as f:
        json.dump(stocks, f, ensure_ascii=False, indent=2)
    logger.info("寫入 %s", stocks_path)
    logger.info("總結：抓 %d 支 / 跳過 %d 支 / 失敗 %d 支", fetched, skipped, failed)

    # 統計分佈
    c = Counter(s.get("market", "未知") for s in stocks)
    logger.info("市場分佈：")
    for k, v in c.most_common():
        logger.info("  %s: %d 支", k, v)

    if failed_ids:
        logger.warning("抓不到 market 的股票（前 20 支）：%s",
                       ", ".join(failed_ids[:20]))

    return 0


if __name__ == "__main__":
    sys.exit(run())
