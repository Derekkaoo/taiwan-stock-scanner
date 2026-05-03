#!/usr/bin/env python3
"""
fetch_monthly_revenue.py 從 MOPS 抓月營收 + YoY%

執行：venv\\Scripts\\python.exe ..\\scripts\\fetch_monthly_revenue.py
輸出：backend/db/monthly_revenue.json

設計（2026-05-03 改 merge 模式）：
  - 公司 1 號起就會陸續公告上月營收，10 號前幾乎全部公告完
  - 改抓「上月」+「上上月」兩個月，per-stock merge：每支股票用最新有資料的月份
  - 跟現有 monthly_revenue.json merge（不 overwrite），保留尚未公告的股票上月資料
  - per-stock 加 month 欄位記錄資料對應月份
  - 對 stocks.json 列表中還沒拿到上月資料的股票，走 Yahoo fallback
    (https://tw.stock.yahoo.com/quote/{id}.{TW|TWO}/revenue)
"""
import json, logging, re, sys, time
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, Optional, Tuple

import requests
from bs4 import BeautifulSoup

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

DB_DIR = Path(__file__).parent.parent / "backend" / "db"
DB_DIR.mkdir(parents=True, exist_ok=True)
OUT_PATH = DB_DIR / "monthly_revenue.json"
RAW_DIR  = DB_DIR / "monthly_revenue_raw"
RAW_DIR.mkdir(parents=True, exist_ok=True)

STOCKS_JSON = Path(__file__).parent.parent / "frontend" / "public" / "data" / "stocks.json"

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}


# ============================================================
#  MOPS scraper（批次抓全市場）
# ============================================================
def fetch_market(year, month, kind, is_foreign=False):
    """抓一個市場某月資料。kind: sii=上市, otc=上櫃；is_foreign: True=KY 股"""
    roc_year = year - 1911
    suffix = "1" if is_foreign else "0"
    url = f"https://mopsov.twse.com.tw/nas/t21/{kind}/t21sc03_{roc_year}_{month}_{suffix}.html"
    label = f"{kind}({'外國' if is_foreign else '本國'})"
    logger.info("MOPS 抓 %s (%d/%02d) %s", label, year, month, url)
    try:
        r = requests.get(url, headers=HEADERS, timeout=30)
        if r.status_code != 200:
            logger.warning("HTTP %d for %s", r.status_code, url)
            return None
        r.encoding = "big5"
        raw_path = RAW_DIR / f"{year}_{month:02d}_{kind}_{suffix}.html"
        raw_path.write_text(r.text, encoding="utf-8")
        return r.text
    except Exception as e:
        logger.error("MOPS 抓取失敗：%s", e)
        return None


def parse_mops_table(html):
    """解析 MOPS 表格。回傳 {sid: {"name": str, "revenue": int, "yoy": float|None}}"""
    soup = BeautifulSoup(html, "lxml")
    result = {}

    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        if len(rows) < 20:
            continue
        for tr in rows:
            tds = tr.find_all("td")
            if len(tds) < 8:
                continue
            sid = tds[0].get_text(strip=True)
            if not re.match(r"^\d{4}$", sid):
                continue
            name = tds[1].get_text(strip=True)

            def to_int(s):
                s = s.replace(",", "").replace(" ", "").strip()
                return int(s) if s.isdigit() else None

            def to_float(s):
                s = s.replace(",", "").replace("%", "").replace(" ", "").strip()
                try:
                    return float(s)
                except ValueError:
                    return None

            revenue = to_int(tds[2].get_text(strip=True)) if len(tds) > 2 else None
            yoy     = to_float(tds[6].get_text(strip=True)) if len(tds) > 6 else None

            result[sid] = {"name": name, "revenue": revenue, "yoy": yoy}
    return result


def fetch_target_months() -> Dict[str, Dict[str, Any]]:
    """抓「上月」+「上上月」兩個月份，回傳 {month_str: {sid: data}}。

    上月可能還沒全部公告（1-9 號），上上月應該全部都有，merge 用。
    """
    now = datetime.now()
    combos = [
        ("sii", False),  # 上市本國
        ("sii", True),   # 上市 KY
        ("otc", False),  # 上櫃本國
        ("otc", True),   # 上櫃 KY
    ]

    by_month: Dict[str, Dict[str, Any]] = {}

    for delta in (1, 2):  # 上月、上上月
        y = now.year
        m = now.month - delta
        while m <= 0:
            y -= 1
            m += 12
        month_str = f"{y:04d}-{m:02d}"

        merged: Dict[str, Any] = {}
        for kind, is_foreign in combos:
            html = fetch_market(y, m, kind, is_foreign)
            if html:
                merged.update(parse_mops_table(html))
            time.sleep(0.3)

        if merged:
            logger.info("  → MOPS %s 抓到 %d 支", month_str, len(merged))
            by_month[month_str] = merged
        else:
            logger.warning("  → MOPS %s 沒抓到任何資料", month_str)

    return by_month


# ============================================================
#  Yahoo fallback（per-stock）
# ============================================================
YAHOO_REVENUE_URL = "https://tw.stock.yahoo.com/quote/{sid}.{suffix}/revenue"


def fetch_yahoo_revenue(stock_id: str, target_month: str) -> Optional[Dict[str, Any]]:
    """從 Yahoo TW finance 抓單支股票的最新月營收，找指定 month。

    Args:
      stock_id: 股票代號（4 碼數字）
      target_month: 目標月份 "YYYY-MM"
    Returns:
      {"name", "revenue", "yoy", "month"} 或 None
    """
    for suffix in ("TW", "TWO"):
        url = YAHOO_REVENUE_URL.format(sid=stock_id, suffix=suffix)
        try:
            r = requests.get(url, headers=HEADERS, timeout=10)
            if r.status_code != 200:
                continue
        except Exception:
            continue

        # Yahoo 把資料嵌在 inline JSON / __NEXT_DATA__；先試 HTML 表格 fallback
        soup = BeautifulSoup(r.text, "lxml")

        # 先嘗試找股票名稱
        name_el = soup.find("h1")
        name = name_el.get_text(strip=True) if name_el else ""
        # 名稱通常是「2330 台積電」，把代號 strip 掉
        if name.startswith(stock_id):
            name = name[len(stock_id):].strip()

        # 找包含「月別 / 月營收 / 年增率」的 table
        # Yahoo 表格欄位：日期 / 月營收 / 月增率 / 年增率 / 累計營收 / 累計年增率
        for table in soup.find_all("table"):
            rows = table.find_all("tr")
            if len(rows) < 2:
                continue
            for tr in rows[1:]:  # 跳 header
                tds = tr.find_all(["td", "th"])
                if len(tds) < 4:
                    continue
                date_str = tds[0].get_text(strip=True)
                # date_str 格式可能是 "2026/04" 或 "115/04"（民國）
                m1 = re.match(r"^(\d{4})/(\d{1,2})$", date_str)
                m2 = re.match(r"^(\d{2,3})/(\d{1,2})$", date_str)
                if m1:
                    yyyy, mm = int(m1.group(1)), int(m1.group(2))
                elif m2:
                    yyyy = int(m2.group(1)) + 1911
                    mm = int(m2.group(2))
                else:
                    continue

                row_month = f"{yyyy:04d}-{mm:02d}"
                if row_month != target_month:
                    continue

                # tds[1] = 月營收（單位千元）
                rev_str = tds[1].get_text(strip=True).replace(",", "")
                rev = int(rev_str) if rev_str.lstrip("-").isdigit() else None
                # tds[3] = 年增率 % （可能含「%」、可能是負數）
                yoy_str = tds[3].get_text(strip=True).replace("%", "").replace(",", "").strip()
                try:
                    yoy = float(yoy_str)
                except ValueError:
                    yoy = None

                return {
                    "name": name,
                    "revenue": rev,
                    "yoy": yoy,
                    "month": target_month,
                }
        # 沒找到該 stock 的目標月 row → 換下一個 suffix
    return None


# ============================================================
#  merge 邏輯
# ============================================================
def load_existing() -> Dict[str, Any]:
    if not OUT_PATH.exists():
        return {"month": "", "data": {}}
    try:
        return json.loads(OUT_PATH.read_text(encoding="utf-8"))
    except Exception as e:
        logger.warning("讀取現有 %s 失敗：%s", OUT_PATH, e)
        return {"month": "", "data": {}}


def merge_data(
    existing: Dict[str, Dict[str, Any]],
    new_by_month: Dict[str, Dict[str, Dict[str, Any]]],
) -> Dict[str, Dict[str, Any]]:
    """per-stock 合併：每支用最新（max month）的資料。

    Args:
      existing: 舊 data dict {sid: {name, revenue, yoy, month?}}
      new_by_month: 新抓資料 {month_str: {sid: {...}}}
    Returns:
      merged data dict {sid: {name, revenue, yoy, month}}
    """
    out: Dict[str, Dict[str, Any]] = {}

    # 先把舊資料倒進來（補上 month 欄位若沒有）
    for sid, entry in existing.items():
        out[sid] = {**entry}
        if "month" not in out[sid]:
            out[sid]["month"] = ""

    # 依月份從新到舊排序，逐一塞入
    for month_str in sorted(new_by_month.keys(), reverse=True):
        for sid, entry in new_by_month[month_str].items():
            existing_month = out.get(sid, {}).get("month", "")
            if existing_month >= month_str:
                continue  # 舊資料已是同月或更新
            out[sid] = {
                "name":    entry.get("name") or out.get(sid, {}).get("name", ""),
                "revenue": entry.get("revenue"),
                "yoy":     entry.get("yoy"),
                "month":   month_str,
            }

    return out


# ============================================================
#  主流程
# ============================================================
def expected_latest_month() -> str:
    """月營收預期 = 上個月（公司 1 號起就會陸續公告）。"""
    now = datetime.now()
    y, m = now.year, now.month
    if m == 1:
        return f"{y-1:04d}-12"
    return f"{y:04d}-{m-1:02d}"


def run(yahoo_fallback: bool = False, max_yahoo: int = 50):
    """主流程。

    Args:
      yahoo_fallback: 是否啟用 Yahoo per-stock fallback（預設 False — 目前 scraper 對
        Yahoo TW finance 的 inline JSON 結構不熟，0 成功率。要 enable 需要先驗證
        Yahoo HTML 抓得到該支股票該月資料，可參考 scrape_institutional.py 的
        _fetch_yahoo_one 模式擴展。MOPS merge 已能 cover 大部分情境。
        CLI 用 --yahoo enable）
      max_yahoo: 最多 Yahoo fallback 幾支
    """
    target_month = expected_latest_month()
    logger.info("目標月份：%s（上個月）", target_month)

    # 1. 讀現有資料
    existing_doc = load_existing()
    existing_data = existing_doc.get("data", {})
    logger.info("現有 monthly_revenue.json 含 %d 支", len(existing_data))

    # 2. 抓 MOPS 上月 + 上上月
    new_by_month = fetch_target_months()
    if not new_by_month:
        logger.error("MOPS 沒抓到任何資料，保留現有檔不動")
        sys.exit(1)

    # 3. merge
    merged_data = merge_data(existing_data, new_by_month)
    target_count = sum(1 for v in merged_data.values() if v.get("month") == target_month)
    logger.info("merge 後共 %d 支，其中目標月 %s 有 %d 支",
                len(merged_data), target_month, target_count)

    # 4. Yahoo fallback：對 stocks.json 列表中、月份還停在「上上月或更早」的股票試 Yahoo
    if yahoo_fallback and STOCKS_JSON.exists():
        try:
            stocks = json.loads(STOCKS_JSON.read_text(encoding="utf-8"))
            tracked_ids = [s.get("id") for s in stocks if s.get("id")]
        except Exception as e:
            logger.warning("讀 stocks.json 失敗，跳過 Yahoo fallback：%s", e)
            tracked_ids = []

        # 找需要 fallback 的：tracked_ids 中、merged_data 該支 month 不是 target_month
        need_fallback = [
            sid for sid in tracked_ids
            if merged_data.get(sid, {}).get("month", "") != target_month
        ]
        if need_fallback:
            logger.info("Yahoo fallback：%d 支需要試（最多跑 %d 支）", len(need_fallback), max_yahoo)
            yahoo_ok = 0
            for sid in need_fallback[:max_yahoo]:
                entry = fetch_yahoo_revenue(sid, target_month)
                time.sleep(0.4)  # Yahoo throttle
                if entry:
                    merged_data[sid] = entry
                    yahoo_ok += 1
                    logger.info("  ✅ Yahoo %s 抓到 %s 月營收", sid, target_month)
            logger.info("Yahoo fallback 完成：%d / %d 成功", yahoo_ok, min(len(need_fallback), max_yahoo))
        else:
            logger.info("無需 Yahoo fallback（tracked stocks 都已是 %s）", target_month)

    # 5. 寫回（file-level month = 所有 stock 的 max）
    file_month = max(
        (v.get("month", "") for v in merged_data.values()),
        default="",
    )
    payload = {
        "month": file_month,
        "data":  merged_data,
    }
    OUT_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    target_after = sum(1 for v in merged_data.values() if v.get("month") == target_month)
    logger.info("儲存至 %s（共 %d 支，目標月 %s 有 %d 支）",
                OUT_PATH, len(merged_data), target_month, target_after)

    # 樣本輸出
    sample_ids = ["2330", "2317", "2303", "1301", "2454"]
    logger.info("樣本抽驗：")
    for sid in sample_ids:
        d = merged_data.get(sid)
        if d:
            logger.info("  %s %-8s 營收=%s YoY=%s%% (%s)",
                        sid, d.get("name", ""),
                        f"{d['revenue']:,}" if d.get("revenue") else "—",
                        d.get("yoy") if d.get("yoy") is not None else "—",
                        d.get("month", "?"))
        else:
            logger.info("  %s (無資料)", sid)


if __name__ == "__main__":
    # CLI flags：--yahoo 啟用 fallback、--max-yahoo N 限制 Yahoo 嘗試數
    args = sys.argv[1:]
    yahoo_fallback = "--yahoo" in args
    max_yahoo = 50
    if "--max-yahoo" in args:
        i = args.index("--max-yahoo")
        if i + 1 < len(args):
            try:
                max_yahoo = int(args[i + 1])
            except ValueError:
                pass
    run(yahoo_fallback=yahoo_fallback, max_yahoo=max_yahoo)
