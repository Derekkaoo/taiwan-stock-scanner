#!/usr/bin/env python3
"""
fetch_monthly_revenue.py 從 MOPS 抓月營收 + YoY%
執行：venv\Scripts\python.exe ..\scripts\fetch_monthly_revenue.py
輸出：backend/db/monthly_revenue.json
"""
import json, logging, re, sys, time
from pathlib import Path
from datetime import datetime

import requests
from bs4 import BeautifulSoup

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

DB_DIR = Path(__file__).parent.parent / "backend" / "db"
DB_DIR.mkdir(parents=True, exist_ok=True)
OUT_PATH = DB_DIR / "monthly_revenue.json"
RAW_DIR  = DB_DIR / "monthly_revenue_raw"
RAW_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}


def fetch_market(year, month, kind, is_foreign=False):
    """抓一個市場某月資料。
    kind: sii=上市, otc=上櫃
    is_foreign: False=本國公司(_0.html), True=外國公司/KY股(_1.html)
    """
    roc_year = year - 1911
    suffix = "1" if is_foreign else "0"
    url = f"https://mopsov.twse.com.tw/nas/t21/{kind}/t21sc03_{roc_year}_{month}_{suffix}.html"
    label = f"{kind}({'外國' if is_foreign else '本國'})"
    logger.info("抓 %s (%d/%02d) %s", label, year, month, url)
    try:
        r = requests.get(url, headers=HEADERS, timeout=30)
        if r.status_code != 200:
            logger.warning("HTTP %d for %s", r.status_code, url)
            return None, None
        r.encoding = "big5"
        raw_path = RAW_DIR / f"{year}_{month:02d}_{kind}_{suffix}.html"
        raw_path.write_text(r.text, encoding="utf-8")
        return r.text, raw_path
    except Exception as e:
        logger.error("抓取失敗：%s", e)
        return None, None
        r.encoding = "big5"  # MOPS 用 big5
        raw_path = RAW_DIR / f"{year}_{month:02d}_{kind}.html"
        raw_path.write_text(r.text, encoding="utf-8")
        return r.text, raw_path
    except Exception as e:
        logger.error("抓取失敗：%s", e)
        return None, None


def parse_mops_table(html):
    """
    解析 MOPS 表格。回傳 {股票代號: {"yoy": float/None, "revenue": int/None, "name": str}}
    MOPS 典型欄位順序（民國 110+）：
      0: 公司代號
      1: 公司名稱
      2: 當月營收
      3: 上月營收
      4: 去年當月營收
      5: 上月比較 (MoM %)
      6: 去年同月增減 (YoY %)
      7: 當月累計營收
      8: 去年累計營收
      9: 前期比較 (累計 YoY %)
     10: 備註
    """
    soup = BeautifulSoup(html, "lxml")
    result = {}

    # MOPS 頁面有多個 <table>，有些是 header/navigation，要過濾。
    # 真正資料表的 <tr> 數通常 >= 20，且第一個 td 是 4 碼數字。
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


def try_months():
    """依序嘗試今月、上月、上上月。第一個有資料（>100 筆）的就用。
    每個月抓 4 個檔案：上市本國/外國、上櫃本國/外國（含 KY 股）"""
    now = datetime.now()
    combos = [
        ("sii", False),  # 上市 本國
        ("sii", True),   # 上市 外國 (KY 股)
        ("otc", False),  # 上櫃 本國
        ("otc", True),   # 上櫃 外國 (KY 股)
    ]
    for delta in range(0, 4):
        y = now.year
        m = now.month - delta
        while m <= 0:
            y -= 1
            m += 12
        merged = {}
        for kind, is_foreign in combos:
            html, _ = fetch_market(y, m, kind, is_foreign)
            if html:
                merged.update(parse_mops_table(html))
            time.sleep(0.3)
        if len(merged) >= 100:
            logger.info("找到 %d/%02d 的資料：%d 支（含本國+KY 股）", y, m, len(merged))
            return (y, m), merged
        else:
            logger.info("%d/%02d 資料不足（%d 筆），嘗試上個月…", y, m, len(merged))
    return None, {}


def run():
    found_month, data = try_months()
    if not data:
        logger.error("沒抓到任何資料。請檢查 %s 下的 raw HTML 看結構", RAW_DIR)
        sys.exit(1)

    payload = {
        "month": f"{found_month[0]}-{found_month[1]:02d}",
        "data":  data,
    }
    OUT_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    logger.info("儲存至 %s (%d 支)", OUT_PATH, len(data))

    # 樣本輸出
    sample_ids = ["2330", "2317", "2303", "1301", "2454"]
    logger.info("樣本抽驗：")
    for sid in sample_ids:
        if sid in data:
            d = data[sid]
            logger.info("  %s %-8s 營收=%s YoY=%s%%",
                        sid, d["name"], f"{d['revenue']:,}" if d["revenue"] else "—",
                        d["yoy"] if d["yoy"] is not None else "—")
        else:
            logger.info("  %s (無資料)", sid)


if __name__ == "__main__":
    run()
