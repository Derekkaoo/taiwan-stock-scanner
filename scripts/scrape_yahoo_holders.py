#!/usr/bin/env python3
"""
scrape_yahoo_holders.py — Yahoo 大戶籌碼 fallback（norway 沒更新時用）

從 Yahoo TW finance 抓所有股票的「千張大戶持股率」週週歷史，
filter 出本週週增持 >= 0.1% 的股票（跟 norway 一樣的條件）。

來源：https://tw.stock.yahoo.com/quote/{id}.{TW|TWO}/major-holders
資料定義：mainHoldPercent = 持股 ≥ 1000 張之大戶 / 總發行股數 × 100% （= norway 大戶籌碼）

輸出：backend/db/yahoo_holdings.json
  {
    "updated": "2026-05-16T15:00:00",
    "date": "2026-05-15",      ← 最新週末日（mainHoldPercent 計算日）
    "rows": [
      {"id":"2330", "name":"台積電", "delta":-0.11, "holdingPct":85.47,
       "marketCap":0, "date":"2026-05-15"},
      ...
    ]
  }

用法：
  python scripts/scrape_yahoo_holders.py            # 全跑 ~1964 支
  python scripts/scrape_yahoo_holders.py --limit 50 # 只跑前 50 支（測試用）
"""
import json
import logging
import re
import sys
import time
from datetime import datetime
from pathlib import Path

import requests

ROOT = Path(__file__).parent.parent
DB_DIR = ROOT / "backend" / "db"
INDUSTRY_MAP_PATH = DB_DIR / "stock_industry_map.json"
OUT_PATH = DB_DIR / "yahoo_holdings.json"

URL = "https://tw.stock.yahoo.com/quote/{sid}.{suffix}/major-holders"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
THROTTLE = 0.3  # 0.3s/支 → 1964 支約 10 分鐘
MIN_DELTA = 0.1  # 跟 norway 一樣：週增持 ≥ 0.1% 才算入榜

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


def fetch_yahoo_major_holders(stock_id: str):
    """抓單支股票的週週千張大戶持股率歷史。
    回傳 list of dict 或 None（兩個 suffix 都失敗）。
    """
    for suffix in ("TW", "TWO"):
        url = URL.format(sid=stock_id, suffix=suffix)
        try:
            r = requests.get(url, headers=HEADERS, timeout=15)
            if r.status_code != 200:
                continue
        except Exception:
            continue
        html = r.text

        marker = '"majorHolders":{"data":{"list":['
        idx = html.find(marker)
        if idx < 0:
            continue
        # 抽 [...] 內容
        start = idx + len(marker)
        depth = 1
        cur = start
        while cur < len(html) and depth > 0:
            ch = html[cur]
            if ch == "[":
                depth += 1
            elif ch == "]":
                depth -= 1
            cur += 1
        if depth != 0:
            continue
        list_str = html[start:cur - 1]

        records = []
        for m in re.finditer(
            r'"dirSupHoldPercent":"([\d.]+)",'
            r'"endDate":"(\d{4}-\d{2}-\d{2})[^"]*",'
            r'"foreignHoldPercent":"([\d.]+)",'
            r'"mainHolderCount":"(\d+)",'
            r'"mainHoldPercent":"([\d.]+)"',
            list_str
        ):
            dir_sup, end_date, foreign, holder_count, main_hold = m.groups()
            records.append({
                "endDate":          end_date,
                "mainHoldPercent":  float(main_hold),
                "mainHolderCount":  int(holder_count),
                "foreignHoldPercent": float(foreign),
            })
        if records:
            return records
    return None


def load_stock_list():
    """從 stock_industry_map.json 拿到要抓的股票清單 [(id, name), ...]"""
    if not INDUSTRY_MAP_PATH.exists():
        logger.error("stock_industry_map.json 不存在")
        return []
    with open(INDUSTRY_MAP_PATH, encoding="utf-8") as f:
        data = json.load(f)
    # 結構：{"2330": {"name": "台積電", "industries": [...]}, ...}
    result = []
    for sid, info in data.items():
        if not re.match(r"^\d{4}$", sid):
            continue  # 跳過 5 位數興櫃 / 權證
        name = info.get("name", "") if isinstance(info, dict) else ""
        result.append((sid, name))
    return result


def fetch_all_yahoo_holdings(limit=None):
    """跑全 ~1964 支股票，回傳 (latest_date, rows)。
    給 run_pipeline.py 當主來源 import 用；也是 CLI mode 共用的核心邏輯。

    Returns:
      (latest_date_str, rows): 同 norway fetch_holdings() 格式
      rows = [{id, name, delta, holdingPct, marketCap=0, date}, ...]
    """
    stocks = load_stock_list()
    logger.info("股票清單：%d 支", len(stocks))
    if limit:
        stocks = stocks[:limit]
        logger.info("--limit %d 啟用：只跑前 %d 支", limit, limit)

    rows = []
    latest_date = ""
    fetched = 0
    no_data = 0
    skipped = 0

    for i, (sid, name) in enumerate(stocks, 1):
        records = fetch_yahoo_major_holders(sid)
        time.sleep(THROTTLE)
        if not records or len(records) < 2:
            no_data += 1
            continue
        fetched += 1
        # records[0] 是最新一週，records[1] 是上週
        latest = records[0]
        prev   = records[1]
        delta = latest["mainHoldPercent"] - prev["mainHoldPercent"]
        # 同 norway 條件：delta >= 0.1
        if delta < MIN_DELTA:
            skipped += 1
            continue
        rows.append({
            "id":         sid,
            "name":       name,
            "delta":      round(delta, 3),
            "holdingPct": latest["mainHoldPercent"],
            "marketCap":  0,  # Yahoo major-holders 沒這欄位（暫時 0，downstream 自己填或不 filter）
            "date":       latest["endDate"],
        })
        if latest["endDate"] > latest_date:
            latest_date = latest["endDate"]

        if i % 50 == 0:
            logger.info("進度 %d/%d（抓 %d / 入榜 %d / no_data %d / 未達 0.1%% %d）",
                        i, len(stocks), fetched, len(rows), no_data, skipped)

    logger.info("完成：抓 %d 支 / 入榜 %d / no_data %d / 未達 0.1%% %d",
                fetched, len(rows), no_data, skipped)
    logger.info("最新週末日：%s", latest_date)
    return latest_date, rows


def main():
    """CLI mode：跑全部 + 寫 JSON 檔（給手動觸發 / debug 用）"""
    args = sys.argv[1:]
    limit = None
    if "--limit" in args:
        i = args.index("--limit")
        limit = int(args[i + 1])

    latest_date, rows = fetch_all_yahoo_holdings(limit=limit)

    out = {
        "updated": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
        "date":    latest_date,
        "rows":    rows,
    }
    DB_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    logger.info("寫入 %s（%d KB）", OUT_PATH, OUT_PATH.stat().st_size // 1024)


if __name__ == "__main__":
    main()
