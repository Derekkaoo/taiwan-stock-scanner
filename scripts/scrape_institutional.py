"""
scrape_institutional.py — 抓三大法人買賣超

資料源：FinMind API
  dataset = TaiwanStockInstitutionalInvestorsBuySell
  每天每支股票會有多筆紀錄（外資、投信、自營商各一筆），需用 stock_id + name 分組

每日跑：
  - 從 stocks.json 讀現有股票清單
  - 撈最近 N 個交易日的三大法人資料
  - 整理 → backend/db/institutional.json

JSON 結構：
  {
    "updated":  "2026-04-26T19:00:00",
    "by_stock": {
      "2330": [
        {"date": "2026-04-25", "foreign": 12345, "trust": 678, "dealer": -123},
        ...                       # 最多 KEEP_DAYS 筆
      ],
      ...
    }
  }
單位：張（1 張 = 1000 股）— 後端轉好，正 = 買超、負 = 賣超

用法：
  python scripts/scrape_institutional.py
"""
import json
import logging
import os
import sys
import time
from collections import defaultdict
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

TOKEN = os.environ.get("FINMIND_TOKEN", "").strip()

API = "https://api.finmindtrade.com/api/v4/data"

DATA_DIR = Path(__file__).parent.parent / "frontend" / "public" / "data"
DB_DIR   = Path(__file__).parent.parent / "backend" / "db"
OUT_PATH = DB_DIR / "institutional.json"

KEEP_DAYS = 30          # 保留最近 N 個交易日
LOOKBACK_DAYS = 30      # FinMind 撈幾天往前
USER_AGENT = "Mozilla/5.0"


# 三大法人 name 對應：FinMind 用中文 + 細項，這裡 normalize 成 3 大類
def _classify_name(name: str) -> str | None:
    """name 字串 → 'foreign' / 'trust' / 'dealer' / None（其他細項忽略）"""
    if not name:
        return None
    n = name.strip()
    # 外資（含外國自然人、外國法人、不含外資自營商）
    if n in ("Foreign_Investor", "外資", "外資及陸資", "外資及陸資(不含外資自營商)",
             "Foreign_Dealer_Self"):  # 注意：有時會分開
        return "foreign"
    # 投信
    if n in ("Investment_Trust", "投信"):
        return "trust"
    # 自營商
    if n in ("Dealer", "自營商", "Dealer_self", "Dealer_Hedging",
             "自營商(自行買賣)", "自營商(避險)"):
        return "dealer"
    return None


def fetch_finmind(stock_id: str, start_date: str):
    """抓單支股票最近的三大法人資料。回傳 list of records 或 None"""
    params = {
        "dataset":    "TaiwanStockInstitutionalInvestorsBuySell",
        "data_id":    stock_id,
        "start_date": start_date,
    }
    if TOKEN:
        params["token"] = TOKEN
    try:
        r = requests.get(API, params=params, timeout=30,
                         headers={"User-Agent": USER_AGENT})
        if r.status_code == 402:
            logger.warning("[%s] FinMind 402 額度用完", stock_id)
            return None
        if r.status_code != 200:
            logger.debug("[%s] FinMind HTTP %d", stock_id, r.status_code)
            return None
        j = r.json()
        if j.get("status") != 200:
            return None
        return j.get("data") or []
    except Exception as e:
        logger.debug("[%s] FinMind 例外：%s", stock_id, e)
        return None


def normalize_records(records: list[dict]) -> dict[str, dict]:
    """records → {date: {foreign, trust, dealer}}（單位：張）"""
    by_date = defaultdict(lambda: {"foreign": 0, "trust": 0, "dealer": 0})
    for r in records or []:
        date = r.get("date")
        cat  = _classify_name(r.get("name", ""))
        if not date or not cat:
            continue
        # FinMind: buy / sell 都是「股」，net = (buy - sell)；轉「張」 ÷1000
        buy  = r.get("buy")  or 0
        sell = r.get("sell") or 0
        try:
            net = (int(buy) - int(sell)) / 1000.0
        except (TypeError, ValueError):
            continue
        # 同類別累加（外資自營商 + 一般外資 都計入 foreign）
        by_date[date][cat] += round(net)
    return dict(by_date)


def load_stock_ids() -> list[str]:
    p = DATA_DIR / "stocks.json"
    if not p.exists():
        logger.error("stocks.json 不存在 — 先跑 run_pipeline / update_klines")
        return []
    raw = json.loads(p.read_text(encoding="utf-8"))
    return [s["id"] for s in raw]


def load_existing() -> dict:
    if not OUT_PATH.exists():
        return {"updated": "", "by_stock": {}}
    try:
        return json.loads(OUT_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {"updated": "", "by_stock": {}}


def run():
    if not TOKEN:
        logger.warning("無 FINMIND_TOKEN — 仍可嘗試（免費版有限制）")

    stock_ids = load_stock_ids()
    if not stock_ids:
        return 1
    logger.info("共 %d 支股票要抓三大法人", len(stock_ids))

    # 起始日：今天往前 LOOKBACK_DAYS 天
    from datetime import datetime, timedelta
    start_date = (datetime.now() - timedelta(days=LOOKBACK_DAYS)).strftime("%Y-%m-%d")

    db = load_existing()
    by_stock = db.get("by_stock") or {}

    fetched = 0
    skipped = 0
    quota_hit = False
    for i, sid in enumerate(stock_ids, 1):
        records = fetch_finmind(sid, start_date)
        if records is None:
            quota_hit = True   # FinMind 額度可能用完，後面就用 cache
            break
        if not records:
            skipped += 1
        else:
            new_data = normalize_records(records)
            # merge（同日覆蓋，保留歷史 KEEP_DAYS 天）
            existing_history = by_stock.get(sid) or []
            existing_dates = {h["date"] for h in existing_history}
            for date, vals in new_data.items():
                if date in existing_dates:
                    # 覆蓋
                    for h in existing_history:
                        if h["date"] == date:
                            h.update(vals)
                            break
                else:
                    existing_history.append({"date": date, **vals})
            existing_history.sort(key=lambda x: x.get("date", ""))
            existing_history = existing_history[-KEEP_DAYS:]
            by_stock[sid] = existing_history
            fetched += 1

        time.sleep(0.15)  # 節流，避免被 ban
        if i % 30 == 0:
            logger.info("進度 %d/%d（成功 %d / 跳過 %d）", i, len(stock_ids), fetched, skipped)

    db["updated"]  = time.strftime("%Y-%m-%dT%H:%M:%S")
    db["by_stock"] = by_stock

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, separators=(",", ":"))

    logger.info("寫入 %s", OUT_PATH)
    logger.info("  成功 %d 支 / 跳過 %d / %s",
                fetched, skipped,
                "額度用完，部分用快取" if quota_hit else "全部完成")
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    sys.exit(run())
