#\!/usr/bin/env python3
"""
poc_product_share_v3.py 鎖定 t05st08（各項產品業務營收統計表）
"""
import logging, time
from pathlib import Path
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

OUT_DIR = Path(__file__).parent.parent / "backend" / "db" / "poc_product_share_v3"
OUT_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
}

session = requests.Session()
session.headers.update(HEADERS)

# warm session
for u in ["https://mopsov.twse.com.tw/mops/web/index", "https://mopsov.twse.com.tw/mops/web/t05st08"]:
    try:
        r = session.get(u, timeout=20)
        logger.info("warm %s → %d", u, r.status_code)
    except Exception as e:
        logger.warning("warm fail %s: %s", u, e)
    time.sleep(0.5)

TESTS = [("2330", "sii"), ("2317", "sii"), ("3008", "sii")]

def run_case(name, url, data, sid, typek):
    data = {k: (v.replace("{sid}", sid).replace("{typek}", typek) if isinstance(v, str) else v)
            for k, v in data.items()}
    try:
        r = session.post(url, data=data, headers={**HEADERS,
                          "Referer": "https://mopsov.twse.com.tw/mops/web/t05st08",
                          "X-Requested-With": "XMLHttpRequest"}, timeout=30)
        r.encoding = "utf-8"
        out = OUT_DIR / f"{sid}_{name}_status{r.status_code}.html"
        out.write_text(r.text, encoding="utf-8")
        tables = r.text.count("<table")
        keys = [k for k in ["產品", "營業收入", "銷售", "比重", "占比"] if k in r.text]
        logger.info("%s %s → status=%d len=%d tables=%d keys=%s",
                    sid, name, r.status_code, len(r.text), tables, keys)
    except Exception as e:
        logger.error("%s %s → %s", sid, name, e)

for sid, typek in TESTS:
    logger.info("===== %s =====", sid)
    # MOPSov 舊版 t05st08 AJAX
    run_case("A_mopsov_t05st08_step1",
             "https://mopsov.twse.com.tw/mops/web/ajax_t05st08",
             {"step": "1", "firstin": "1", "off": "1",
              "keyword4": "", "code1": "", "TYPEK2": "",
              "checkbtn": "", "queryName": "co_id", "inpuType": "co_id",
              "TYPEK": "{typek}", "isnew": "false", "co_id": "{sid}",
              "year": "113"},
             sid, typek)
    time.sleep(1)
    # 可能需要 step=2
    run_case("B_mopsov_t05st08_step2",
             "https://mopsov.twse.com.tw/mops/web/ajax_t05st08",
             {"step": "2", "firstin": "1", "off": "1",
              "queryName": "co_id", "inpuType": "co_id",
              "TYPEK": "{typek}", "isnew": "false", "co_id": "{sid}",
              "year": "113"},
             sid, typek)
    time.sleep(1)
    # 新版 mops.twse.com.tw
    run_case("C_mops_t05st08",
             "https://mops.twse.com.tw/mops/web/ajax_t05st08",
             {"step": "1", "firstin": "1", "off": "1",
              "queryName": "co_id", "inpuType": "co_id",
              "TYPEK": "{typek}", "isnew": "false", "co_id": "{sid}",
              "year": "113"},
             sid, typek)
    time.sleep(1)
    # GET 方式（有些 MOPS endpoint 直接 GET 帶 query string 也能拿到）
    try:
        url = f"https://mopsov.twse.com.tw/mops/web/t05st08?step=1&firstin=1&off=1&co_id={sid}&TYPEK={typek}&year=113&isnew=false"
        r = session.get(url, timeout=30)
        r.encoding = "utf-8"
        out = OUT_DIR / f"{sid}_D_mopsov_t05st08_GET_status{r.status_code}.html"
        out.write_text(r.text, encoding="utf-8")
        keys = [k for k in ["產品", "營業收入", "銷售", "比重", "占比"] if k in r.text]
        logger.info("%s D_GET → status=%d len=%d tables=%d keys=%s",
                    sid, r.status_code, len(r.text), r.text.count("<table"), keys)
    except Exception as e:
        logger.error("%s D_GET → %s", sid, e)
    time.sleep(1)

logger.info("完成，請檢查 %s", OUT_DIR)
