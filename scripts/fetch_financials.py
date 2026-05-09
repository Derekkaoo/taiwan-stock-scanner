#!/usr/bin/env python3
"""
fetch_financials.py 抓 FinMind 月營收 + 季財報，算出 4 個 YoY 陣列

需要環境變數 FINMIND_TOKEN（或 .env 檔）
輸出：backend/db/financials.json
  {
    "2330": {
      "revenueYoY":         [{"date": "2024-04", "yoy": 28.5}, ...12 個月],
      "grossMarginYoY":     [{"quarter": "2024Q1", "yoy": 3.2}, ...8 季],
      "operatingMarginYoY": [{"quarter": "2024Q1", "yoy": 4.1}, ...8 季],
      "epsYoY":             [{"quarter": "2024Q1", "yoy": 18.7}, ...8 季],
    },
    ...
  }

FinMind 免費方案限 600 req/小時，腳本會自動節流；若額度用完就用現有快取。
"""
import os, json, logging, re, sys, time
from pathlib import Path
from collections import defaultdict
import requests

# 讀 .env
ENV_PATH = Path(__file__).parent.parent / ".env"
if ENV_PATH.exists():
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.strip().startswith("#"):
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

TOKEN = os.environ.get("FINMIND_TOKEN", "")
if not TOKEN:
    print("ERROR: 找不到 FINMIND_TOKEN")
    sys.exit(1)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

API = "https://api.finmindtrade.com/api/v4/data"
DATA_DIR = Path(__file__).parent.parent / "frontend" / "public" / "data"
DB_DIR   = Path(__file__).parent.parent / "backend" / "db"
OUT_PATH = DB_DIR / "financials.json"

MONTHS_BACK = 13  # 多抓 1 個月，才能算 YoY
QUARTERS_BACK = 8  # 最近 8 季 YoY
QUARTERS_FETCH = QUARTERS_BACK + 4  # 多抓 4 季，算同季 YoY


def load_stock_ids():
    """從 stocks.json 拿到要抓的股票代號"""
    stocks_path = DATA_DIR / "stocks.json"
    if not stocks_path.exists():
        logger.error("stocks.json 不存在")
        return []
    with open(stocks_path, encoding="utf-8") as f:
        stocks = json.load(f)
    return list({s["id"] for s in stocks})


def fetch(dataset, stock_id, start_date):
    params = {"dataset": dataset, "data_id": stock_id, "start_date": start_date, "token": TOKEN}
    try:
        r = requests.get(API, params=params, timeout=30)
        if r.status_code == 402:
            logger.warning("402 額度用完，停止")
            return None
        j = r.json()
        if j.get("status") != 200:
            return None
        return j.get("data", [])
    except Exception as e:
        logger.debug("fetch %s %s 失敗：%s", dataset, stock_id, e)
        return None


def parse_revenue_yoy(records):
    """從月營收紀錄算 YoY。回傳最近 12 個月的 [{date: YYYY-MM, yoy: 28.5}, ...]"""
    if not records:
        return []
    # 用 (year, month) 建 map
    by_ym = {}
    for r in records:
        y, m = r.get("revenue_year"), r.get("revenue_month")
        rev = r.get("revenue")
        if y and m and rev:
            by_ym[(y, m)] = rev
    if not by_ym:
        return []
    # 排序取最新的 12 個月
    keys = sorted(by_ym.keys())[-MONTHS_BACK:]
    result = []
    for (y, m) in keys:
        curr = by_ym.get((y, m))
        prev = by_ym.get((y - 1, m))
        if curr and prev and prev > 0:
            yoy = round((curr - prev) / prev * 100, 2)
            result.append({"date": f"{y:04d}-{m:02d}", "yoy": yoy})
    return result[-12:]  # 最多 12 筆


def _quarter_str(date_str):
    """把 "2024-03-31" 轉成 "2024Q1" """
    m = re.match(r"^(\d{4})-(\d{2})-", date_str or "")
    if not m:
        return None
    year = int(m.group(1))
    month = int(m.group(2))
    q = (month - 1) // 3 + 1
    return f"{year}Q{q}"


def parse_financial_yoy(records):
    """從季財報紀錄算出 6 條序列：3 個 YoY + 3 個絕對值。
    回傳 dict： {
        "grossMarginYoY":     [...],   "grossMargin":     [...],   # %
        "operatingMarginYoY": [...],   "operatingMargin": [...],   # %
        "epsYoY":             [...],   "eps":             [...],   # 元
    }
    YoY 序列: [{"quarter":"2024Q1","yoy":3.2}]；絕對值序列: [{"quarter":"2024Q1","value":53.1}]
    各取最近 QUARTERS_BACK 季。
    """
    # by_q = {"2024Q1": {"Revenue": ..., "GrossProfit": ..., "OperatingIncome": ..., "EPS": ...}}
    by_q = defaultdict(dict)
    for r in records:
        qstr = _quarter_str(r.get("date", ""))
        if not qstr:
            continue
        t = r.get("type", "")
        v = r.get("value")
        if v is None:
            continue
        if t in ("Revenue", "GrossProfit", "OperatingIncome", "EPS"):
            by_q[qstr][t] = v

    quarters = sorted(by_q.keys())

    def get_yoy_series(compute_metric):
        series = []
        for q in quarters:
            curr = compute_metric(by_q[q])
            y, qn = q.split("Q")
            prev_q = f"{int(y)-1}Q{qn}"
            prev = compute_metric(by_q.get(prev_q, {}))
            if curr is not None and prev is not None and abs(prev) > 0.001:
                yoy = round((curr - prev) / abs(prev) * 100, 2)
                series.append({"quarter": q, "yoy": yoy})
        return series[-QUARTERS_BACK:]

    def get_abs_series(compute_metric):
        """每季絕對值。None 直接跳過、不補。取最近 QUARTERS_BACK 季有值的"""
        series = []
        for q in quarters:
            v = compute_metric(by_q[q])
            if v is not None:
                series.append({"quarter": q, "value": round(v, 2)})
        return series[-QUARTERS_BACK:]

    def gross_margin(d):
        rev, gp = d.get("Revenue"), d.get("GrossProfit")
        if rev and gp and rev > 0:
            return gp / rev * 100
        return None

    def op_margin(d):
        rev, oi = d.get("Revenue"), d.get("OperatingIncome")
        if rev and oi and rev > 0:
            return oi / rev * 100
        return None

    def eps(d):
        return d.get("EPS")

    return {
        "grossMarginYoY":     get_yoy_series(gross_margin),
        "operatingMarginYoY": get_yoy_series(op_margin),
        "epsYoY":             get_yoy_series(eps),
        "grossMargin":        get_abs_series(gross_margin),
        "operatingMargin":    get_abs_series(op_margin),
        "eps":                get_abs_series(eps),
    }


def load_existing():
    if OUT_PATH.exists():
        try:
            with open(OUT_PATH, encoding="utf-8") as f:
                return json.load(f)
        except:
            return {}
    return {}



def expected_latest_revenue_month(today):
    """月營收預期 = 上個月（公司 1 號起就會陸續公告，10 號前公告完）。

    注意：1-9 號跑時上月可能還沒全部公告，per-stock should_refresh_revenue 會
    各自決定是否 fetch（已抓過上月的跳過、沒抓過的試 FinMind 一次）。
    """
    y, m = today.year, today.month
    prev_y, prev_m = (y, m - 1) if m > 1 else (y - 1, 12)
    return f"{prev_y:04d}-{prev_m:02d}"


def is_reporting_month(today):
    """季報公告期當月：3 月（年報截止 3/31）、5 月（Q1 截止 5/15）、
    8 月（Q2 截止 8/14）、11 月（Q3 截止 11/14）。
    這幾個月部分公司會提前公告，所以邏輯上「報表月當月」就期待該季資料。
    """
    return today.month in (3, 5, 8, 11)


def expected_latest_quarter(today):
    """今天可以預期拿到的最新已公告季財報。

    報表月當月（3/5/8/11）就期待該季 — 提前公告的公司會抓到，沒公告的下次再試。
    其他月份取最近一個已過官方截止日的季別。
    """
    y, m = today.year, today.month

    # 報表月當月：直接期待該季（提前公告的公司有資料）
    if   m == 3:  return f"{y-1}Q4"   # 3 月：去年年報
    elif m == 5:  return f"{y}Q1"     # 5 月：當年 Q1
    elif m == 8:  return f"{y}Q2"     # 8 月：當年 Q2
    elif m == 11: return f"{y}Q3"     # 11 月：當年 Q3

    # 非報表月：取最近一個官方截止後的季別
    if   m == 4:                          return f"{y-1}Q4"   # 4 月（年報截止 3/31 後）
    elif m == 6 or m == 7:                return f"{y}Q1"     # 6-7 月（Q1 截止 5/15 後）
    elif m == 9 or m == 10:               return f"{y}Q2"     # 9-10 月（Q2 截止 8/14 後）
    elif m == 12:                         return f"{y}Q3"     # 12 月（Q3 截止 11/14 後）
    else:                                 return f"{y-1}Q3"   # 1-2 月：去年 Q3 還是最後完整公告


_RETRY_THROTTLE_SEC = 6 * 3600  # 6 小時內已嘗試過抓「不夠新」資料就跳過


def should_refresh_revenue(entry, today):
    if not entry:
        return True
    arr = entry.get("revenueYoY") or []
    if not arr:
        return True
    last = arr[-1].get("date", "")
    if last >= expected_latest_revenue_month(today):
        return False  # 已是預期月份 → 跳過
    # 沒到預期月份但 throttle：6 小時內試過 → 暫時跳過（FinMind 不太可能有新資料）
    last_attempt = entry.get("_last_rev_attempt_ts", 0)
    if time.time() - last_attempt < _RETRY_THROTTLE_SEC:
        return False
    return True


def should_refresh_financials(entry, today):
    if not entry:
        return True
    arr = entry.get("epsYoY") or []
    if not arr:
        return True
    # 若 entry 還沒有絕對值序列（舊格式），也要重抓補上
    if not entry.get("eps") or not entry.get("grossMargin") or not entry.get("operatingMargin"):
        return True
    last = arr[-1].get("quarter", "")
    if last >= expected_latest_quarter(today):
        return False  # 已是預期 → 跳過
    # 報表月（3/5/8/11）：忽略 throttle，每次 cron run 都嘗試抓（拿到新資料才會推進 last 跳出迴圈）
    if is_reporting_month(today):
        return True
    # 非報表月：throttle 6 小時（FinMind 不太可能有新資料）
    last_attempt = entry.get("_last_fin_attempt_ts", 0)
    if time.time() - last_attempt < _RETRY_THROTTLE_SEC:
        return False
    return True


def run(stock_ids: list[str] | None = None):
    """跑財報抓取。
    - stock_ids=None：從 stocks.json 讀（舊行為）
    - stock_ids=[…]：只跑指定股票（Plan E：本週入榜的 310 支，archive 內其他股票保留舊資料）
    """
    if stock_ids is None:
        stock_ids = load_stock_ids()
    if not stock_ids:
        return
    logger.info("共 %d 支股票要抓", len(stock_ids))

    # 起始日期：月營收多抓 2 年（才能算 12 個月 YoY）；財報抓近 3 年（要 8 季 YoY）
    today = time.strftime("%Y-%m-%d")
    rev_start = f"{int(today[:4]) - 2}-01-01"
    fin_start = f"{int(today[:4]) - 3}-01-01"

    existing = load_existing()
    result = {}

    from datetime import datetime
    today = datetime.now()

    total = len(stock_ids)
    skipped = 0
    fetched_rev = 0
    fetched_fin = 0
    for i, sid in enumerate(stock_ids, 1):
        entry = existing.get(sid, {}).copy()  # 從快取起步

        need_rev = should_refresh_revenue(entry, today)
        need_fin = should_refresh_financials(entry, today)

        if not need_rev and not need_fin:
            # 這支資料是最新的，跳過
            result[sid] = entry
            skipped += 1
            continue

        if need_rev:
            rev_records = fetch("TaiwanStockMonthRevenue", sid, rev_start)
            time.sleep(0.3)
            entry["_last_rev_attempt_ts"] = int(time.time())  # throttle 用
            if rev_records is not None:
                revenue_yoy = parse_revenue_yoy(rev_records)
                if revenue_yoy:
                    entry["revenueYoY"] = revenue_yoy
                    fetched_rev += 1

        if need_fin:
            fin_records = fetch("TaiwanStockFinancialStatements", sid, fin_start)
            time.sleep(0.3)
            entry["_last_fin_attempt_ts"] = int(time.time())  # throttle 用
            if fin_records is not None:
                parsed = parse_financial_yoy(fin_records)
                if any(parsed.values()):
                    entry.update(parsed)  # 同時寫入 6 條序列
                    fetched_fin += 1
            else:
                # FinMind 額度上限或失敗 → 嘗試 Yahoo fallback
                try:
                    from scrape_yahoo_financials import fetch_yahoo_financials
                    yahoo_data = fetch_yahoo_financials(sid)
                    if yahoo_data and any(yahoo_data.values()):
                        entry.update(yahoo_data)
                        fetched_fin += 1
                        logger.info("  ↳ Yahoo fallback 成功 %s", sid)
                except ImportError:
                    pass
                except Exception as e:
                    logger.debug("Yahoo fallback %s 失敗：%s", sid, e)

        # 若 entry 仍然空的（新股票 + 兩個 API 都失敗），放棄此支
        if entry:
            result[sid] = entry

        if i % 20 == 0:
            logger.info("進度 %d/%d（剛處理：%s，略過 %d、抓 rev %d / fin %d）",
                        i, total, sid, skipped, fetched_rev, fetched_fin)
            DB_DIR.mkdir(parents=True, exist_ok=True)
            with open(OUT_PATH, "w", encoding="utf-8") as f:
                json.dump(result, f, ensure_ascii=False, indent=2)

    DB_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    # 簡短統計
    n_with = sum(1 for v in result.values() if v.get("revenueYoY") or v.get("epsYoY"))
    logger.info("完成：%d 支有資料 / 總 %d 支", n_with, total)
    logger.info("輸出：%s", OUT_PATH)


if __name__ == "__main__":
    run()
