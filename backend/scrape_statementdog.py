"""
scrape_statementdog.py
從財報狗抓取台股概念股族群分類
執行方式：venv\Scripts\python.exe scrape_statementdog.py
"""
import json
import time
import logging
import requests
from pathlib import Path
from bs4 import BeautifulSoup

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}

# 財報狗族群 tag ID → 我們的族群名稱
# 優先順序：同一支股票若出現在多個族群，越前面的優先
TAGS = {
    # AI 相關
    '5509':  'AI伺服器',
    '1475':  'AI伺服器',       # 機殼（伺服器機殼）
    '826':   'AI伺服器',       # EMS代工
    '1188':  'AI資料中心',
    '17390': 'AI資料中心',

    # 散熱
    '489':   '散熱',
    '19887': '散熱',           # 液冷散熱
    '26065': '散熱',

    # 光通訊 / CPO / 矽光子
    '19288': 'CPO矽光子',
    '10405': 'CPO矽光子',      # 光通訊
    '48029': 'CPO矽光子',      # CPO
    '55583': 'CPO矽光子',      # 光學元件

    # 先進封裝 / CoWoS
    '1468':  'CoWoS先進封裝',
    '15964': 'CoWoS先進封裝',
    '5369':  'CoWoS先進封裝',  # 先進製程

    # PCB / 載板
    '351':   'PCB載板',
    '957':   'PCB載板',
    '410':   'PCB載板',        # 銅箔基板CCL

    # 半導體
    '172':   '被動元件',
    '194':   '連接器',
    '977':   '記憶體DRAM',
    '1412':  'IC設計/半導體',
    '2163':  'IC設計/半導體',
    '101':   '晶圓代工',
    '946':   '晶圓代工',
    '1388':  'IC設計/半導體',

    # 電源 / 電力
    '1440':  '電源供應器',
    '8471':  '電源供應器',
    '938':   '電源供應器',
    '366':   '重電電網',
    '540':   '重電電網',
    '577':   '重電電網',       # 智慧電網

    # 機器人 / 自動化
    '1450':  '機器人',
    '12760': '機器人',
    '8541':  '機器人',         # Optimus
    '2207':  '機器人',
    '306':   '工業自動化',

    # 太陽能 / 綠能
    '653':   '太陽能',
    '5917':  '太陽能',
    '1250':  '太陽能',

    # 通訊
    '1477':  '5G通訊',
    '321':   '5G通訊',
    '966':   '5G通訊',

    # 車用
    '66':    '車用電子',
    '197':   '車用電子',
    '1176':  '車用電子',

    # 光學
    '273':   '光學/鏡頭',
    '491':   '光學/鏡頭',
    '320':   '光電/LED',
    '357':   '光電/LED',
    '394':   '光電/LED',

    # 其他電子
    '319':   '電腦及週邊',
    '322':   '電子零組件',
    '42009': '電子零組件',
    '698':   '電子零組件',
    '1451':  'IC設計/半導體',  # HPC

    # 低軌衛星
    '1452':  '低軌衛星',
    '376':   '低軌衛星',
    '45055': '低軌衛星',
}

DICT_PATH   = Path(__file__).parent.parent / "frontend" / "public" / "data" / "stock_dict.json"
STOCKS_PATH = Path(__file__).parent.parent / "frontend" / "public" / "data" / "stocks.json"


def get_tag_stocks(tag_id: str) -> list[str]:
    """抓取特定 tag 頁面的股票代號"""
    try:
        r = requests.get(
            f'https://statementdog.com/tags/{tag_id}',
            headers=HEADERS,
            timeout=15
        )
        if r.status_code != 200:
            return []
        soup = BeautifulSoup(r.text, 'lxml')
        codes = []
        for a in soup.find_all('a', href=True):
            href = a['href']
            if '/analysis/' in href:
                for p in href.split('/'):
                    if len(p) == 4 and p.isdigit():
                        if p not in codes:
                            codes.append(p)
        return codes
    except Exception as e:
        logger.warning("tag %s 抓取失敗：%s", tag_id, e)
        return []


def build_mapping() -> dict[str, str]:
    """建立 stock_id → group_name 的 mapping"""
    mapping: dict[str, str] = {}
    total = len(TAGS)

    for i, (tag_id, group_name) in enumerate(TAGS.items(), 1):
        codes = get_tag_stocks(tag_id)
        new_count = 0
        for code in codes:
            if code not in mapping:   # 第一個命中的族群優先
                mapping[code] = group_name
                new_count += 1
        logger.info("[%d/%d] %s (%s)：共 %d 支，新增 %d 支",
                    i, total, group_name, tag_id, len(codes), new_count)
        time.sleep(0.6)   # 避免請求太快被擋

    logger.info("財報狗 mapping 完成：共 %d 支股票", len(mapping))
    return mapping


def update_files(mapping: dict[str, str]):
    """將 mapping 結果更新到 stock_dict.json 和 stocks.json"""

    # 更新 stock_dict.json
    if DICT_PATH.exists():
        with open(DICT_PATH, encoding='utf-8') as f:
            stock_dict = json.load(f)
        updated = 0
        for sid, group in mapping.items():
            if sid in stock_dict:
                stock_dict[sid]['group'] = group
                updated += 1
        with open(DICT_PATH, 'w', encoding='utf-8') as f:
            json.dump(stock_dict, f, ensure_ascii=False, indent=2)
        logger.info("stock_dict.json 更新：%d 支", updated)

    # 更新 stocks.json
    if STOCKS_PATH.exists():
        with open(STOCKS_PATH, encoding='utf-8') as f:
            stocks = json.load(f)
        updated = 0
        for stock in stocks:
            sid = stock['id']
            if sid in mapping:
                stock['group'] = mapping[sid]
                updated += 1
        with open(STOCKS_PATH, 'w', encoding='utf-8') as f:
            json.dump(stocks, f, ensure_ascii=False, indent=2)
        logger.info("stocks.json 更新：%d 支", updated)

        # 統計族群分布
        from collections import Counter
        groups = Counter(s['group'] for s in stocks)
        logger.info("族群分布（前 20）：")
        for g, cnt in groups.most_common(20):
            logger.info("  %-22s %d 支", g, cnt)


if __name__ == '__main__':
    mapping = build_mapping()
    update_files(mapping)
    logger.info("完成！請重新整理瀏覽器查看結果")