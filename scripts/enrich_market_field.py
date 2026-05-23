"""
enrich_market_field.py — 一次性腳本：補 stocks.json 的 market 欄位

背景：
  2026-05-23 把 market 欄位加進 run_pipeline.py，但 smart-skip 會跳過 Step 2，
  所以新欄位寫不進去。這個腳本只跑 Step 2 + 寫回 stocks.json，~10 秒搞定，
  不用等完整 pipeline。

用法：
  python scripts/enrich_market_field.py

完成後：
  - frontend/public/data/stocks.json 每筆會多 "market": "上市" / "上櫃" / ""
  - 前端「上市櫃」filter 立即可用

之後 run_pipeline 跑 Step 2 時也會繼續寫，這個腳本只是「補追」用，未來不需再跑。
"""
from __future__ import annotations

import json
import logging
import re
import sys
from pathlib import Path

import requests
from bs4 import BeautifulSoup

# Windows console UTF-8
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logger = logging.getLogger(__name__)

ROOT = Path(__file__).parent.parent
STOCKS_JSON = ROOT / "frontend" / "public" / "data" / "stocks.json"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    )
}


def fetch_market_map() -> dict[str, str]:
    """從 TWSE isin 端點抓 stock_id → 上市/上櫃 對應表"""
    result: dict[str, str] = {}
    for mode in ["2", "4"]:
        market = "上市" if mode == "2" else "上櫃"
        logger.info("抓 strMode=%s (%s) ...", mode, market)
        r = requests.get(
            f"https://isin.twse.com.tw/isin/C_public.jsp?strMode={mode}",
            headers=HEADERS, timeout=30,
        )
        soup = BeautifulSoup(r.text, "lxml")
        added = 0
        for row in soup.find_all("tr"):
            tds = row.find_all("td")
            if len(tds) < 5:
                continue
            m = re.match(r"^(\d{4})　(.+)$", tds[0].text.strip())
            if not m:
                continue
            sid = m.group(1)
            if sid not in result:
                result[sid] = market
                added += 1
        logger.info("  %s 新增 %d 支（累計 %d）", market, added, len(result))
    return result


def main():
    if not STOCKS_JSON.exists():
        logger.error("stocks.json 不存在：%s", STOCKS_JSON)
        sys.exit(1)

    logger.info("讀取 %s", STOCKS_JSON)
    with open(STOCKS_JSON, encoding="utf-8") as f:
        stocks = json.load(f)
    logger.info("  共 %d 支", len(stocks))

    market_map = fetch_market_map()
    logger.info("isin map：%d 支", len(market_map))

    enriched = 0
    missing = 0
    for s in stocks:
        sid = s.get("id", "")
        m = market_map.get(sid, "")
        if m:
            s["market"] = m
            enriched += 1
        else:
            s["market"] = ""
            missing += 1

    logger.info("匹配 %d / 找不到 %d", enriched, missing)
    if missing:
        # 列前幾個找不到的，方便 debug
        not_found = [s["id"] for s in stocks if not s.get("market")][:10]
        logger.info("找不到對應的前 10 支：%s", not_found)

    with open(STOCKS_JSON, "w", encoding="utf-8") as f:
        json.dump(stocks, f, ensure_ascii=False, indent=2)
    logger.info("已寫回 stocks.json")
    logger.info("done")


if __name__ == "__main__":
    main()
