#\!/usr/bin/env python3
"""
poc_product_share_v2.py 第二輪試抓產品營收占比
執行：venv\Scripts\python.exe ..\scripts\poc_product_share_v2.py
"""
import json, logging, sys, time
from pathlib import Path
import requests
from bs4 import BeautifulSoup

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

OUT_DIR = Path(__file__).parent.parent / "backend" / "db" / "poc_product_share_v2"
OUT_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
}

# 先用 session，visit 一次 mops index 拿 cookie，再送後續請求
session = requests.Session()
session.headers.update(HEADERS)

# 台積電上市 (sii)、鴻海上市 (sii)、大立光上市 (sii)
# 我們都放 sii，因為這 3 支都是上市
TEST_STOCKS = [("2330", "sii"), ("2317", "sii"), ("3008", "sii")]


def warm_session():
    """先 visit 首頁拿 cookie"""
    for url in [
        "https://mopsov.twse.com.tw/mops/web/index",
        "https://mops.twse.com.tw/mops/web/index",
    ]:
        try:
            r = session.get(url, timeout=20)
            logger.info("warm %s → %d", url, r.status_code)
        except Exception as e:
            logger.warning("warm fail %s: %s", url, e)


def try_fetch(name, method, url, data=None, referer=None):
    """通用抓取器"""
    headers = dict(HEADERS)
    if referer:
        headers["Referer"] = referer
        headers["X-Requested-With"] = "XMLHttpRequest"
    try:
        if method == "POST":
            r = session.post(url, headers=headers, data=data, timeout=30)
        else:
            r = session.get(url, headers=headers, timeout=30)
        # 嘗試 encoding
        if "mopsov" in url or "mops.twse" in url:
            # 新版通常是 utf-8，舊版可能 big5
            r.encoding = "utf-8"
        else:
            r.encoding = r.apparent_encoding or "utf-8"
        out_path = OUT_DIR / f"{name}_status{r.status_code}.html"
        out_path.write_text(r.text, encoding="utf-8")
        length = len(r.text)
        keywords = ["產品", "銷售", "營業收入", "比重", "營收比", "占比", "Product"]
        found = [k for k in keywords if k in r.text]
        tables = r.text.count("<table")
        logger.info("%s → status=%d, len=%d, tables=%d, keys=%s",
                    name, r.status_code, length, tables, found[:5])
        return r
    except Exception as e:
        logger.error("%s → %s", name, e)
        return None


def main():
    logger.info("開始第二輪嘗試…")
    warm_session()
    time.sleep(1)

    for sid, typek in TEST_STOCKS:
        logger.info("===== %s (%s) =====", sid, typek)

        # A. MOPSov t164sb02 帶 TYPEK + step=2
        try_fetch(
            f"{sid}_A_mopsov_t164sb02_step2",
            "POST",
            "https://mopsov.twse.com.tw/mops/web/ajax_t164sb02",
            data={
                "step": "2",
                "firstin": "1",
                "off": "1",
                "queryName": "co_id",
                "inpuType": "co_id",
                "TYPEK": typek,
                "isnew": "false",
                "co_id": sid,
                "year": "113",
                "season": "",
            },
            referer="https://mopsov.twse.com.tw/mops/web/t164sb02",
        )
        time.sleep(1)

        # B. MOPS 新版 t164sb02 with TYPEK
        try_fetch(
            f"{sid}_B_mops_t164sb02_full",
            "POST",
            "https://mops.twse.com.tw/mops/web/ajax_t164sb02",
            data={
                "step": "1",
                "firstin": "1",
                "off": "1",
                "queryName": "co_id",
                "inpuType": "co_id",
                "TYPEK": typek,
                "isnew": "false",
                "co_id": sid,
                "year": "113",
                "season": "",
                "checkbtn": "",
            },
            referer="https://mops.twse.com.tw/mops/web/t164sb02",
        )
        time.sleep(1)

        # C. 簡明財務報表（可能含產品）
        try_fetch(
            f"{sid}_C_mopsov_t05st10",
            "GET",
            f"https://mopsov.twse.com.tw/mops/web/t05st10_ifrs?step=1&firstin=1&off=1&co_id={sid}&TYPEK={typek}&year=113&isnew=false",
        )
        time.sleep(1)

        # D. Goodinfo 不同頁面
        try_fetch(
            f"{sid}_D_goodinfo_StockDetail",
            "GET",
            f"https://goodinfo.tw/tw/StockDetail.asp?STOCK_ID={sid}",
        )
        time.sleep(1)

        try_fetch(
            f"{sid}_E_goodinfo_ShowSaleSortedList",
            "GET",
            f"https://goodinfo.tw/tw/StockBzPerformance.asp?STOCK_ID={sid}",
        )
        time.sleep(1)

        # F. 鉅亨網產品/業別
        try_fetch(
            f"{sid}_F_cnyes_product",
            "GET",
            f"https://www.cnyes.com/twstock/{sid}/overview/business",
        )
        time.sleep(1)

        # G. FinMind: 看 TaiwanStockInfo 有沒有產品相關
        try_fetch(
            f"{sid}_G_finmind_info",
            "GET",
            f"https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInfo&data_id={sid}",
        )
        time.sleep(1)

    logger.info("全部完成！請檢查 %s", OUT_DIR)


if __name__ == "__main__":
    main()
