#\!/usr/bin/env python3
"""
poc_product_share.py 試抓產品營收占比的 proof-of-concept
執行：venv\Scripts\python.exe ..\scripts\poc_product_share.py
輸出：backend/db/poc_product_share/{stock_id}_{source}.html
"""
import json, logging, sys, time
from pathlib import Path
import requests
from bs4 import BeautifulSoup

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

OUT_DIR = Path(__file__).parent.parent / "backend" / "db" / "poc_product_share"
OUT_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
}

# 要測試的幾個 endpoint
# MOPS 常用 POST 介面，參數跟 form 一樣
MOPS_ENDPOINTS = [
    # 產品銷售資料（年度）
    {
        "name": "mops_t164sb02_ajax_annual",
        "url": "https://mops.twse.com.tw/mops/web/ajax_t164sb02",
        "method": "POST",
        "data": {
            "encodeURIComponent": "1",
            "step": "1",
            "firstin": "1",
            "off": "1",
            "queryName": "co_id",
            "inpuType": "co_id",
            "TYPEK": "all",
            "isnew": "false",
            "co_id": "{sid}",
            "year": "113",   # 民國年，先試 113 年 (2024)
            "season": "",    # 空字串 = 年度
        },
    },
    # 試老版 mopsov
    {
        "name": "mopsov_t164sb02",
        "url": "https://mopsov.twse.com.tw/mops/web/ajax_t164sb02",
        "method": "POST",
        "data": {
            "step": "1",
            "firstin": "1",
            "off": "1",
            "queryName": "co_id",
            "TYPEK": "all",
            "isnew": "false",
            "co_id": "{sid}",
            "year": "113",
            "season": "",
        },
    },
    # 主要產品情形
    {
        "name": "mops_t05st20",
        "url": "https://mops.twse.com.tw/mops/web/ajax_t05st20_ifrs",
        "method": "POST",
        "data": {
            "step": "1",
            "firstin": "1",
            "off": "1",
            "queryName": "co_id",
            "TYPEK": "all",
            "co_id": "{sid}",
            "year": "113",
        },
    },
    # Goodinfo 頁面（可能需要 cookie / referer）
    {
        "name": "goodinfo",
        "url": "https://goodinfo.tw/tw/StockInfo.asp?STOCK_ID={sid}",
        "method": "GET",
    },
]

TEST_STOCKS = ["2330", "2317"]


def try_one(ep, sid):
    """嘗試一個 endpoint，存下回應"""
    url = ep["url"].replace("{sid}", sid)
    name = ep["name"]
    logger.info("%s [%s] %s", sid, name, url[:80])

    try:
        if ep["method"] == "POST":
            data = {k: v.replace("{sid}", sid) for k, v in ep["data"].items()}
            r = requests.post(url, headers=HEADERS, data=data, timeout=30)
        else:
            r = requests.get(url, headers=HEADERS, timeout=30)

        # MOPS 常是 big5，Goodinfo 可能 utf-8
        if "mopsov" in url or "mops.twse" in url:
            r.encoding = "utf-8"  # 新版應該 utf-8，試試
        else:
            r.encoding = r.apparent_encoding or "utf-8"

        out_path = OUT_DIR / f"{sid}_{name}_status{r.status_code}.html"
        out_path.write_text(r.text, encoding="utf-8")

        logger.info("  → status=%d, length=%d, saved=%s",
                    r.status_code, len(r.text), out_path.name)

        # 快速看看有沒有表格 / 關鍵字
        if r.status_code == 200:
            lower = r.text.lower()
            # 檢查是否有產品 / 營收相關字眼
            keywords = ["產品", "銷售", "營業收入", "比重", "product", "revenue"]
            found = [k for k in keywords if k in r.text]
            tables = r.text.count("<table")
            logger.info("  → 內含表格數=%d, 關鍵字命中=%s", tables, found)

    except Exception as e:
        logger.error("  → 失敗：%s", e)


def main():
    logger.info("開始抓取。原始 HTML 會存到：%s", OUT_DIR)
    for sid in TEST_STOCKS:
        for ep in MOPS_ENDPOINTS:
            try_one(ep, sid)
            time.sleep(1)  # 禮貌一點
    logger.info("完成！請檢查 %s 下的 HTML 看哪個 endpoint 有用", OUT_DIR)


if __name__ == "__main__":
    main()
