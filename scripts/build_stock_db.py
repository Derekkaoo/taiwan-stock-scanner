#!/usr/bin/env python3
"""
build_stock_db.py — 爬取 MoneyDJ 所有細產業個股，建立 JSON 資料庫
執行：venv\Scripts\python.exe ..\scripts\build_stock_db.py
預計需要 30~40 分鐘，可以中斷續跑
"""
import json
import requests
import time
import re
import logging
from pathlib import Path
from bs4 import BeautifulSoup

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

DB_DIR = Path(__file__).parent.parent / "backend" / "db"
DB_DIR.mkdir(parents=True, exist_ok=True)

SUB_INDUSTRY_PATH = DB_DIR / "sub_industries.json"   # 細產業清單
STOCK_MAP_PATH    = DB_DIR / "stock_industry_map.json"  # 個股 → 細產業
PROGRESS_PATH     = DB_DIR / "progress.json"            # 爬取進度（斷點續跑用）

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
BASE_URL = "https://www.moneydj.com"


def load_json(path, default):
    if path.exists():
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return default


def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def fetch_all_sub_industries():
    logger.info("爬取所有細產業清單...")
    r = requests.get(f"{BASE_URL}/Z/ZH/ZHA/ZHA.djhtm", headers=HEADERS, timeout=15)
    r.encoding = 'big5'
    soup = BeautifulSoup(r.text, 'lxml')
    seen = set()
    result = []
    for a in soup.find_all('a', href=True):
        href = a.get('href', '')
        if 'zh00' in href and a.text.strip():
            code = href.split('a=')[-1]
            if code not in seen:
                seen.add(code)
                result.append({"code": code, "name": a.text.strip()})
    logger.info("找到 %d 個不重複細產業", len(result))
    return result


def fetch_stocks_for_industry(code):
    url = f"{BASE_URL}/z/zh/zha/zh00.djhtm?a={code}"
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        r.encoding = 'big5'
        soup = BeautifulSoup(r.text, 'lxml')
        stocks = []
        seen = set()
        for tag in soup.find_all(string=re.compile(r'^\d{4}')):
            text = tag.strip()
            if len(text) >= 4 and text[:4].isdigit():
                stock_id   = text[:4]
                stock_name = text[4:].strip()
                if stock_id and stock_name and stock_id not in seen:
                    seen.add(stock_id)
                    stocks.append({"id": stock_id, "name": stock_name})
        return stocks
    except Exception as e:
        logger.debug("爬取 %s 失敗：%s", code, e)
        return []


def run():
    # 載入或爬取細產業清單
    if SUB_INDUSTRY_PATH.exists():
        sub_industries = load_json(SUB_INDUSTRY_PATH, [])
        logger.info("載入已存在的細產業清單：%d 個", len(sub_industries))
    else:
        sub_industries = fetch_all_sub_industries()
        save_json(SUB_INDUSTRY_PATH, sub_industries)

    # 載入進度和現有資料
    progress   = load_json(PROGRESS_PATH, {"done": []})
    stock_map  = load_json(STOCK_MAP_PATH, {})
    done_codes = set(progress["done"])

    remaining = [s for s in sub_industries if s["code"] not in done_codes]
    logger.info("已完成 %d 個，剩餘 %d 個", len(done_codes), len(remaining))

    total = len(remaining)
    for i, sub in enumerate(remaining, 1):
        code = sub["code"]
        name = sub["name"]

        stocks = fetch_stocks_for_industry(code)

        # 更新 stock_map：每支股票可能屬於多個細產業
        for s in stocks:
            sid = s["id"]
            if sid not in stock_map:
                stock_map[sid] = {"name": s["name"], "sub_industries": []}
            # 避免重複加入
            existing_codes = [x["code"] for x in stock_map[sid]["sub_industries"]]
            if code not in existing_codes:
                stock_map[sid]["sub_industries"].append({"code": code, "name": name})

        # 記錄進度
        done_codes.add(code)
        progress["done"].append(code)

        # 每 50 個存一次
        if i % 50 == 0 or i == total:
            save_json(STOCK_MAP_PATH, stock_map)
            save_json(PROGRESS_PATH, progress)
            logger.info("進度：%d/%d（%.1f%%），已覆蓋 %d 支股票",
                        i, total, i/total*100, len(stock_map))

        time.sleep(0.5)

    # 最終存檔
    save_json(STOCK_MAP_PATH, stock_map)
    save_json(PROGRESS_PATH, progress)
    logger.info("完成！共 %d 支股票，%d 個細產業", len(stock_map), len(sub_industries))


if __name__ == "__main__":
    run()