#\!/usr/bin/env python3
"""
poc_finmind.py 驗證 FinMind 回傳資料結構
需要環境變數 FINMIND_TOKEN（或 .env 檔）
"""
import os, json, logging, sys
from pathlib import Path
import requests

# 讀 .env 檔（若存在）
ENV_PATH = Path(__file__).parent.parent / ".env"
if ENV_PATH.exists():
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.strip().startswith("#"):
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

TOKEN = os.environ.get("FINMIND_TOKEN", "")
if not TOKEN:
    print("ERROR: 找不到 FINMIND_TOKEN，請先建立 .env 或設環境變數")
    sys.exit(1)

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

API = "https://api.finmindtrade.com/api/v4/data"

OUT_DIR = Path(__file__).parent.parent / "backend" / "db" / "poc_finmind"
OUT_DIR.mkdir(parents=True, exist_ok=True)


def fetch(dataset, stock_id, start_date):
    params = {
        "dataset": dataset,
        "data_id": stock_id,
        "start_date": start_date,
        "token": TOKEN,
    }
    r = requests.get(API, params=params, timeout=30)
    logger.info("%s %s → status=%d", dataset, stock_id, r.status_code)
    try:
        j = r.json()
        return j
    except Exception as e:
        logger.error("parse failed: %s, text=%s", e, r.text[:200])
        return None


# 測試 2330 台積電
for dataset, start_date, desc in [
    ("TaiwanStockMonthRevenue",       "2024-01-01", "月營收"),
    ("TaiwanStockFinancialStatements", "2023-01-01", "季財報（含 EPS）"),
]:
    print(f"\n===== {desc} ({dataset}) =====")
    data = fetch(dataset, "2330", start_date)
    if data is None:
        continue

    # 存完整 JSON 方便看
    out = OUT_DIR / f"2330_{dataset}.json"
    out.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  已存到 {out}")

    # 印 msg / status / 前 3 筆資料
    print(f"  msg: {data.get('msg')}")
    print(f"  status: {data.get('status')}")
    records = data.get("data", [])
    print(f"  筆數: {len(records)}")
    for r in records[:3]:
        print(f"    {r}")
    print(f"  ... (共 {len(records)} 筆)")

    # 特別：若是財報，看看 type 有哪些
    if dataset == "TaiwanStockFinancialStatements":
        types = sorted(set(r.get("type", "") for r in records))
        print(f"  type 欄位: {types[:30]}")
