#\!/usr/bin/env python3
"""
fetch_industry_hierarchy.py — 從 MoneyDJ 抓取「產業別 → 細產業」的層級對應
執行：venv\Scripts\python.exe ..\scripts\fetch_industry_hierarchy.py
輸出：backend/db/industry_categories.json   格式：{細產業name: 產業別name}
"""
import json, logging, re
from pathlib import Path
import requests
from bs4 import BeautifulSoup

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

DB_DIR = Path(__file__).parent.parent / "backend" / "db"
DB_DIR.mkdir(parents=True, exist_ok=True)

OUT_PATH  = DB_DIR / "industry_categories.json"
RAW_PATH  = DB_DIR / "industry_hierarchy_raw.html"

URL = "https://www.moneydj.com/Z/ZH/ZHA/ZHA.djhtm"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}


def fetch_html():
    logger.info("抓取 %s", URL)
    r = requests.get(URL, headers=HEADERS, timeout=15)
    r.encoding = "big5"
    RAW_PATH.write_text(r.text, encoding="utf-8")
    logger.info("原始 HTML 已存到 %s (%d bytes)", RAW_PATH, len(r.text))
    return r.text


def parse_hierarchy(html):
    """
    MoneyDJ ZHA.djhtm 結構：
      <table id="oMainTable"> 直屬 ~122 個 <tr>：
        第 1-2 列：標題（產業分類 / 產業別|細產業）
        其餘：<td rowspan=N>產業別</td><td>嵌套細產業表</td>
                後續 N-1 列沒有第一個 td（rowspan 覆蓋），只有嵌套細產業表
      每個嵌套細產業表裡面的 <tr> 都要忽略（depth > 1 的 tr 不是資料列）。
    """
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "lxml")

    main_table = soup.find("table", id="oMainTable")
    if main_table is None:
        return {}

    HEADER_WORDS = {"產業分類", "產業別", "細產業", ""}
    mapping = {}
    rowspan_left = 0
    current_cat  = None

    # 只要「parent 就是 main_table」的 tr，這才是外層資料列
    top_rows = [tr for tr in main_table.find_all("tr") if tr.parent is main_table]

    for tr in top_rows:
        # tds 也要限定 tr 的直屬 td
        tds = [td for td in tr.find_all("td") if td.parent is tr]
        if not tds:
            continue

        if rowspan_left > 0:
            subs_cells = tds
            rowspan_left -= 1
        else:
            first = tds[0]
            cat = first.get_text(strip=True)
            if cat in HEADER_WORDS:
                continue
            if len(tds) < 2:
                continue
            current_cat = cat
            rs_attr = first.get("rowspan")
            rs = 1
            if rs_attr:
                try:
                    rs = int(rs_attr)
                except ValueError:
                    rs = 1
            rowspan_left = rs - 1
            subs_cells = tds[1:]

        if not current_cat:
            continue
        for td in subs_cells:
            for a in td.find_all("a", href=True):
                if "zh00" in a.get("href", ""):
                    sub = a.get_text(strip=True)
                    if sub:
                        mapping[sub] = current_cat
    return mapping


def main():
    html = fetch_html()
    mapping = parse_hierarchy(html)

    if not mapping:
        logger.error("解析失敗：mapping 是空的。請把 %s 檔案傳給我，我看結構後調整", RAW_PATH)
        return

    # 匯出
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(mapping, f, ensure_ascii=False, indent=2)

    # 報告
    categories = set(mapping.values())
    logger.info("完成：%d 個細產業 → %d 個產業別", len(mapping), len(categories))
    logger.info("前 10 個產業別範例：")
    for cat in sorted(categories)[:10]:
        subs = [s for s, c in mapping.items() if c == cat]
        logger.info("  %s → %d 個細產業 (%s%s)",
                    cat, len(subs), ", ".join(subs[:3]),
                    "..." if len(subs) > 3 else "")


if __name__ == "__main__":
    main()
