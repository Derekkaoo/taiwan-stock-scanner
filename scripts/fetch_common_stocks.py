"""
FinMind 股本（CapitalStock）快取，用於計算市值 fallback
只在神秘金字塔 td[18] 抓不到市值時使用。

股本（元）/ 面額 10 = 發行股數
市值 = 股數 × 收盤價

FinMind 資料集：TaiwanStockBalanceSheet
  type=CapitalStock 就是股本（普通股）
"""
import json
import logging
import os
import time
from datetime import datetime, timedelta
from pathlib import Path

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

CACHE_PATH = Path(__file__).parent.parent / "backend" / "db" / "common_stocks.json"
FINMIND_API = "https://api.finmindtrade.com/api/v4/data"


def _load_token():
    """從 .env 或 env var 讀 FINMIND_TOKEN"""
    token = os.environ.get("FINMIND_TOKEN", "").strip()
    if token:
        return token
    env_path = Path(__file__).parent.parent / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("FINMIND_TOKEN="):
                return line.split("=", 1)[1].strip()
    return ""


def load_cache():
    if not CACHE_PATH.exists():
        return {}
    try:
        with open(CACHE_PATH, encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.warning("讀 common_stocks 快取失敗：%s", e)
        return {}


def save_cache(cache):
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)


def fetch_one(stock_id, token):
    """抓單支股票最新的 CapitalStock（股本，元）"""
    end = datetime.utcnow() + timedelta(hours=8)
    start = end - timedelta(days=400)
    params = {
        "dataset": "TaiwanStockBalanceSheet",
        "data_id": stock_id,
        "start_date": start.strftime("%Y-%m-%d"),
        "end_date": end.strftime("%Y-%m-%d"),
        "token": token,
    }
    try:
        r = requests.get(FINMIND_API, params=params, timeout=15)
        if not r.ok:
            return None
        payload = r.json()
        rows = payload.get("data") or []
        cap_rows = [x for x in rows if x.get("type") == "CapitalStock"]
        if not cap_rows:
            return None
        cap_rows.sort(key=lambda x: x.get("date", ""), reverse=True)
        latest = cap_rows[0]
        value = latest.get("value")
        if value and value > 0:
            return float(value)
    except Exception as e:
        logger.debug("fetch_one(%s) 失敗：%s", stock_id, e)
    return None


def refresh(stock_ids, max_age_days=60):
    """為指定 stock_ids 刷新 CapitalStock 快取（預設 60 天不重抓）"""
    token = _load_token()
    if not token:
        logger.warning("沒有 FINMIND_TOKEN，跳過 common_stocks fetch")
        return load_cache()

    today = datetime.utcnow() + timedelta(hours=8)
    today_str = today.strftime("%Y-%m-%d")
    cache = load_cache()

    to_fetch = []
    for sid in stock_ids:
        entry = cache.get(sid)
        if not entry:
            to_fetch.append(sid)
            continue
        last = entry.get("date", "")
        try:
            age = (today - datetime.strptime(last, "%Y-%m-%d")).days
            if age >= max_age_days:
                to_fetch.append(sid)
        except ValueError:
            to_fetch.append(sid)

    if not to_fetch:
        logger.info("common_stocks 快取全部已新（%d 支），不用抓", len(stock_ids))
        return cache

    logger.info("需要抓 %d 支 common_stocks（總共 %d 支）", len(to_fetch), len(stock_ids))
    got = 0
    for i, sid in enumerate(to_fetch):
        val = fetch_one(sid, token)
        if val:
            cache[sid] = {"common_stocks": val, "date": today_str}
            got += 1
        if (i + 1) % 20 == 0:
            logger.info("  common_stocks 進度 %d/%d，取得 %d 支",
                        i + 1, len(to_fetch), got)
        time.sleep(0.12)

    save_cache(cache)
    logger.info("完成：抓 %d/%d 支，總快取 %d 支", got, len(to_fetch), len(cache))
    return cache


if __name__ == "__main__":
    rev_path = Path(__file__).parent.parent / "backend" / "db" / "monthly_revenue.json"
    if rev_path.exists():
        with open(rev_path, encoding="utf-8") as f:
            rev = json.load(f)
        ids = list((rev.get("data") or {}).keys())
        refresh(ids)
    else:
        logger.error("找不到 monthly_revenue.json")
