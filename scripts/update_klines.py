import json
import logging
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent.parent / "frontend" / "public" / "data"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

# 預期最新交易日 — 共用模組（考慮國定假日）
sys.path.insert(0, str(Path(__file__).parent))
from trading_calendar import expected_latest_trading_day as _expected_trading_day  # noqa: E402


def _klines_are_fresh():
    """檢查 stocks.json 中所有股票都有最新交易日 bar 才算 fresh。

    舊版只檢查第一支有效股票就 return True，導致：
    - 如果 norway 加新股票 → 新股票沒 bar 但舊股票有 → smart-skip 跳過 → 新股票永遠抓不到 K 線
    新版必須全部股票都到位才跳過。
    """
    klines_path = DATA_DIR / "klines.json"
    stocks_path = DATA_DIR / "stocks.json"
    if not klines_path.exists() or not stocks_path.exists():
        return False
    try:
        with open(klines_path, encoding="utf-8") as f:
            kl = json.load(f)
        with open(stocks_path, encoding="utf-8") as f:
            stocks = json.load(f)
    except Exception as e:
        logger.warning("讀 stocks.json / klines.json 失敗：%s，繼續更新", e)
        return False

    expected = _expected_trading_day()

    def parse_date(s):
        for fmt in ("%Y/%m/%d", "%Y-%m-%d"):
            try:
                return datetime.strptime(s, fmt).date()
            except ValueError:
                continue
        return None

    missing_or_stale = 0
    for s in stocks:
        sid = s.get("id")
        if not sid:
            continue
        bars = kl.get(sid, [])
        if not bars:
            missing_or_stale += 1
            continue
        last = bars[-1].get("date", "")
        latest = parse_date(last) if last else None
        if latest is None or latest < expected:
            missing_or_stale += 1

    if missing_or_stale == 0:
        logger.info("K 線已是最新（%d 支全到 %s），跳過", len(stocks), expected)
        return True

    logger.info("K 線需要更新（%d/%d 支缺資料或過期），繼續抓取",
                missing_or_stale, len(stocks))
    return False


def _split_klines_by_group(klines, stocks):
    """依 stocks 的 groups 把 klines 拆成 klines/<group>.json（Plan B 前端懶載用）"""
    klines_dir = DATA_DIR / "klines"
    if klines_dir.exists():
        for old_file in klines_dir.glob("*.json"):
            old_file.unlink()
    klines_dir.mkdir(parents=True, exist_ok=True)

    group_to_stocks = {}
    for s in stocks:
        for g in s.get("groups", [s.get("group", "")]):
            if not g:
                continue
            group_to_stocks.setdefault(g, set()).add(s["id"])

    total_kb = 0
    for group_name, sid_set in group_to_stocks.items():
        subset = {sid: klines[sid] for sid in sid_set if sid in klines}
        if not subset:
            continue
        safe = group_name.replace("/", "_").replace("\\", "_")
        out_path = klines_dir / f"{safe}.json"
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(subset, f, ensure_ascii=False)
        total_kb += out_path.stat().st_size // 1024
    logger.info("klines/：拆分為 %d 個族群檔，共 %d KB", len(group_to_stocks), total_kb)


def fetch_klines(stock_ids):
    logger.info("K 線更新：%d 支", len(stock_ids))
    klines = {}
    for i, sid in enumerate(stock_ids):
        for suffix in [".TW", ".TWO"]:
            try:
                url = ("https://query1.finance.yahoo.com/v8/finance/chart/"
                       + sid + suffix + "?interval=1d&range=3y")
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
            except Exception:
                continue
        if i % 20 == 0 and i > 0:
            logger.info("  K 線進度：%d/%d", i, len(stock_ids))
        time.sleep(0.15)
    logger.info("K 線取得：%d 支", len(klines))
    return klines


def run():
    force = any(a in ("--force", "-f") for a in sys.argv[1:])
    no_fetch = any(a in ("--no-fetch", "--reuse") for a in sys.argv[1:])

    if not force and not no_fetch and _klines_are_fresh():
        logger.info("K 線資料已是最新，無需更新")
        return

    stocks_path = DATA_DIR / "stocks.json"
    klines_path = DATA_DIR / "klines.json"
    if not stocks_path.exists():
        logger.error("找不到 stocks.json，請先執行 run_pipeline.py")
        return
    with open(stocks_path, encoding="utf-8") as f:
        stocks = json.load(f)
    stock_ids = [s["id"] for s in stocks]
    logger.info("股票清單：%d 支", len(stock_ids))

    if no_fetch:
        # 用現有 klines.json，不重抓（測試衍生欄位用）
        if not klines_path.exists():
            logger.error("找不到 klines.json，--no-fetch 模式需要既存檔")
            return
        with open(klines_path, encoding="utf-8") as f:
            klines = json.load(f)
        logger.info("沿用既存 klines.json：%d 支股票", len(klines))
    else:
        klines = fetch_klines(stock_ids)
        with open(klines_path, "w", encoding="utf-8") as f:
            json.dump(klines, f, ensure_ascii=False)
        size_kb = klines_path.stat().st_size // 1024
        logger.info("klines.json 更新完成：%d 支，%d KB", len(klines), size_kb)

    PERIODS = {"w1": 5, "m1": 21, "m3": 65, "m6": 130, "y1": 252}
    updated = 0
    for s in stocks:
        bars = klines.get(s["id"])
        if not bars or len(bars) < 2:
            continue
        last = bars[-1]["c"]
        if not last:
            continue
        s["price"] = float(last)
        # 市值保留原本值（週六 full pipeline 才會刷新）
        returns = {}
        for key, days in PERIODS.items():
            recent = bars if len(bars) <= days else bars[-(days + 1):]
            first = recent[0]["c"]
            if first:
                returns[key] = round((last - first) / first * 100, 2)
            else:
                returns[key] = None
        s["returns"] = returns
        s["threeMonthReturn"] = returns.get("y1")

        # 成交值（億元）：用 typical price 近似
        # typical_price = (high + low + close) / 3，比單純 close 更接近 VWAP
        # d1=當日；d5=週均；d10=雙週均；d20=月均
        def _bar_turnover(b):
            h = b.get("h") or 0
            l = b.get("l") or 0
            c = b.get("c") or 0
            v = b.get("v") or 0
            tp = (h + l + c) / 3 if (h and l and c) else c
            return tp * v
        turnovers = {}
        # d50 ≈ 10 週均（5 trading days/week × 10 = 50）
        for label, days in [("d1", 1), ("d5", 5), ("d10", 10), ("d20", 20), ("d50", 50)]:
            recent = bars[-days:] if len(bars) >= days else bars
            if recent:
                total = sum(_bar_turnover(b) for b in recent)
                turnovers[label] = round(total / len(recent) / 1e8, 2)
            else:
                turnovers[label] = 0
        s["turnovers"] = turnovers

        volumes = {}
        for label, days in [("d1", 1), ("d5", 5), ("d10", 10), ("d20", 20), ("d50", 50)]:
            recent = bars[-days:] if len(bars) >= days else bars
            if recent:
                total_shares = sum((b.get("v") or 0) for b in recent)
                avg_lots_k = total_shares / len(recent) / 1000 / 1000  # 股 → 張 → 千張
                volumes[label] = round(avg_lots_k, 2)
            else:
                volumes[label] = 0
        s["volumes"] = volumes

        # 52 週新高百分比：current_close / max(high[-252:]) × 100
        recent252 = bars[-252:] if len(bars) >= 252 else bars
        highs252 = [b.get("h") or b.get("c") or 0 for b in recent252]
        high52w = max(highs252) if highs252 else 0
        s["pctOf52wHigh"] = round(last / high52w * 100, 2) if high52w > 0 else None

        # 200 日新高（給選股 2 條件 03 用）
        recent200 = bars[-200:] if len(bars) >= 200 else bars
        highs200 = [b.get("h") or b.get("c") or 0 for b in recent200]
        high200d = max(highs200) if highs200 else 0
        s["pctOf200dHigh"] = round(last / high200d * 100, 2) if high200d > 0 else None

        # 均線 MA10 / MA20 / MA60（用收盤）
        def _ma(n):
            if len(bars) < n: return None
            return round(sum((b.get("c") or 0) for b in bars[-n:]) / n, 2)
        s["ma10"] = _ma(10)
        s["ma20"] = _ma(20)
        s["ma60"] = _ma(60)

        # 20MA 朝上：今日 ma20 vs 5 個交易日前的 ma20
        s["ma20Trend"] = None
        if len(bars) >= 25 and s["ma20"] is not None:
            ma20_5d_ago = round(sum((b.get("c") or 0) for b in bars[-25:-5]) / 20, 2)
            s["ma20Trend"] = "up" if s["ma20"] > ma20_5d_ago else ("down" if s["ma20"] < ma20_5d_ago else "flat")

        # 今日單日漲跌幅 % = (close - prev_close) / prev_close × 100
        s["dailyChangePct"] = None
        if len(bars) >= 2:
            prev_c = bars[-2].get("c") or 0
            if prev_c > 0:
                s["dailyChangePct"] = round((last - prev_c) / prev_c * 100, 2)

        updated += 1
    with open(stocks_path, "w", encoding="utf-8") as f:
        json.dump(stocks, f, ensure_ascii=False, indent=2)
    logger.info("stocks.json 同步更新：%d 支", updated)

    _split_klines_by_group(klines, stocks)

    logger.info("每日更新完成！")


if __name__ == "__main__":
    run()
