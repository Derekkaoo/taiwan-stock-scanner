"""
scrape_twii.py — 抓大盤加權指數 (TWII) 日 K，算 20MA / 60MA。

策略 / screener 用：判斷大盤多空（20MA > 60MA = 多頭）。

資料源：Yahoo Finance chart API（symbol = ^TWII），用 range=1y 取一年資料以算 60MA。

輸出：backend/db/twii.json
  {
    "date":     "2026-04-25",        # 最新交易日
    "close":    23456.78,
    "ma20":     23120.5,
    "ma60":     22580.3,
    "regime":   "bull",              # "bull" 若 ma20 > ma60，否則 "bear"
    "history":  [                    # 最近 60 根 K，給未來其他用途
      {"date": "2026-01-15", "close": 22500.5},
      ...
    ]
  }

用法：
  python scripts/scrape_twii.py
"""
import json
import logging
import sys
import time
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

USER_AGENT = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
              "AppleWebKit/537.36 (KHTML, like Gecko) "
              "Chrome/124.0.0.0 Safari/537.36")

YAHOO_URL = "https://query1.finance.yahoo.com/v8/finance/chart/%5ETWII?interval=1d&range=1y"
YAHOO_URL2 = "https://query2.finance.yahoo.com/v8/finance/chart/%5ETWII?interval=1d&range=1y"

OUT_PATH = Path(__file__).parent.parent / "backend" / "db" / "twii.json"


def fetch_twii():
    """回傳 [{date, close}, ...] 或 None"""
    s = requests.Session()
    s.headers.update({"User-Agent": USER_AGENT, "Accept": "application/json"})
    for url in [YAHOO_URL, YAHOO_URL2]:
        try:
            r = s.get(url, timeout=20)
            r.raise_for_status()
            data = r.json()
        except Exception as e:
            logger.warning("TWII fetch %s 失敗：%s", url, e)
            continue
        try:
            result = data["chart"]["result"][0]
            timestamps = result.get("timestamp") or []
            closes = result.get("indicators", {}).get("quote", [{}])[0].get("close", [])
            bars = []
            for ts, c in zip(timestamps, closes):
                if c is None:
                    continue
                bars.append({
                    "date":  time.strftime("%Y-%m-%d", time.localtime(ts)),
                    "close": round(float(c), 2),
                })
            if len(bars) >= 60:
                return bars
            logger.warning("TWII 抓到 %d 根 < 60，無法算 60MA", len(bars))
        except (KeyError, IndexError, TypeError) as e:
            logger.warning("TWII 解析失敗：%s", e)
    return None


def calc_ma(bars, n):
    """近 n 根收盤均"""
    if len(bars) < n:
        return None
    closes = [b["close"] for b in bars[-n:]]
    return round(sum(closes) / n, 2)


def run():
    bars = fetch_twii()
    if not bars:
        logger.error("TWII 抓取失敗")
        sys.exit(1)

    last = bars[-1]
    ma20 = calc_ma(bars, 20)
    ma60 = calc_ma(bars, 60)

    out = {
        "date":   last["date"],
        "close":  last["close"],
        "ma20":   ma20,
        "ma60":   ma60,
        "regime": "bull" if (ma20 and ma60 and ma20 > ma60) else "bear",
        "history": bars[-60:],   # 給未來其他計算用
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    logger.info("TWII 寫入 %s", OUT_PATH)
    logger.info("  最新日 %s 收盤 %s", out["date"], out["close"])
    logger.info("  20MA %s, 60MA %s → %s", ma20, ma60, out["regime"])


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    run()
