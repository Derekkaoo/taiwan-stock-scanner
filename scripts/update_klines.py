import json
import logging
import time
from pathlib import Path
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent.parent / "frontend" / "public" / "data"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

def fetch_klines(stock_ids):
    logger.info("K 線更新：%d 支", len(stock_ids))
    klines = {}
    for i, sid in enumerate(stock_ids):
        for suffix in [".TW", ".TWO"]:
            try:
                url = ("https://query1.finance.yahoo.com/v8/finance/chart/"
       + sid + suffix + "?interval=1d&range=1y")
                r = requests.get(url, headers=HEADERS, timeout=10)
                if not r.ok:
                    continue
                data = r.json()
                result = data.get("chart", {}).get("result", [None])[0]
                if not result:
                    continue
                timestamps = result.get("timestamp", [])
                ohlcv = result.get("indicators", {}).get("quote", [{}])[0]
                bars = []
                for j, ts in enumerate(timestamps):
                    c = ohlcv.get("close", [None])[j]
                    if c is None:
                        continue
                    bars.append({
                        "date": time.strftime("%Y/%m/%d", time.localtime(ts)),
                        "o": round(ohlcv.get("open",   [0])[j] or 0, 2),
                        "h": round(ohlcv.get("high",   [0])[j] or 0, 2),
                        "l": round(ohlcv.get("low",    [0])[j] or 0, 2),
                        "c": round(c, 2),
                        "v": ohlcv.get("volume", [0])[j] or 0,
                    })
                if len(bars) >= 5:
                    klines[sid] = bars
                    break
            except:
                continue
        if i % 20 == 0 and i > 0:
            logger.info("  K 線進度：%d/%d", i, len(stock_ids))
        time.sleep(0.15)
    logger.info("K 線取得：%d 支", len(klines))
    return klines

def run():
    stocks_path = DATA_DIR / "stocks.json"
    klines_path = DATA_DIR / "klines.json"
    if not stocks_path.exists():
        logger.error("找不到 stocks.json，請先執行 run_pipeline.py")
        return
    with open(stocks_path, encoding="utf-8") as f:
        stocks = json.load(f)
    stock_ids = [s["id"] for s in stocks]
    logger.info("股票清單：%d 支", len(stock_ids))
    klines = fetch_klines(stock_ids)
    with open(klines_path, "w", encoding="utf-8") as f:
        json.dump(klines, f, ensure_ascii=False)
    size_kb = klines_path.stat().st_size // 1024
    logger.info("klines.json 更新完成：%d 支，%d KB", len(klines), size_kb)
    updated = 0
    for s in stocks:
        bars = klines.get(s["id"])
        if not bars:
            continue
        s["price"] = float(bars[-1]["c"])
        if len(bars) >= 2:
            s["threeMonthReturn"] = round(
                (bars[-1]["c"] - bars[0]["c"]) / bars[0]["c"] * 100, 2
            )
        updated += 1
    with open(stocks_path, "w", encoding="utf-8") as f:
        json.dump(stocks, f, ensure_ascii=False, indent=2)
    logger.info("stocks.json 同步更新：%d 支", updated)
    logger.info("每日更新完成！")

if __name__ == "__main__":
    run()