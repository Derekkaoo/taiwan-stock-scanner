#\!/usr/bin/env python3
"""poc_product_share_v4.py t05st08 帶 year+month"""
import logging, time
from pathlib import Path
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

OUT_DIR = Path(__file__).parent.parent / "backend" / "db" / "poc_product_share_v4"
OUT_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
}

session = requests.Session()
session.headers.update(HEADERS)

# warm
session.get("https://mopsov.twse.com.tw/mops/web/index", timeout=20)
session.get("https://mopsov.twse.com.tw/mops/web/t05st08", timeout=20)

# 試多個年/月組合；民國 114 = 西元 2025、民國 113 = 2024
COMBOS = [
    ("114", "2"),  # 最近剛公告的
    ("114", "1"),
    ("113", "12"),
    ("113", "11"),
    ("113", "6"),
]

TESTS = [("2330", "sii"), ("2317", "sii"), ("3008", "sii")]

def run_case(name, sid, typek, year, month, step="1"):
    url = "https://mopsov.twse.com.tw/mops/web/ajax_t05st08"
    data = {
        "step": step,
        "firstin": "1", "off": "1",
        "queryName": "co_id", "inpuType": "co_id",
        "TYPEK": typek, "isnew": "false",
        "co_id": sid, "year": year, "month": month,
    }
    try:
        r = session.post(url, data=data, headers={**HEADERS,
                           "Referer": "https://mopsov.twse.com.tw/mops/web/t05st08",
                           "X-Requested-With": "XMLHttpRequest"}, timeout=30)
        r.encoding = "utf-8"
        out = OUT_DIR / f"{sid}_{year}_{month}_step{step}_status{r.status_code}.html"
        out.write_text(r.text, encoding="utf-8")
        tables = r.text.count("<table")
        keys = [k for k in ["產品", "營業收入", "銷售", "比重", "占比"] if k in r.text]
        # body text 頭 200 字
        from bs4 import BeautifulSoup
        body = BeautifulSoup(r.text, "lxml").get_text(" ", strip=True)[:150]
        logger.info("%s %s/%s s=%s → len=%d tables=%d keys=%s",
                    sid, year, month, step, len(r.text), tables, keys)
        logger.info("    body: %s", body)
    except Exception as e:
        logger.error("%s %s/%s → %s", sid, year, month, e)

for sid, typek in TESTS:
    for (y, m) in COMBOS:
        run_case(f"{sid}_y{y}m{m}", sid, typek, y, m)
        time.sleep(0.5)

logger.info("done → %s", OUT_DIR)
