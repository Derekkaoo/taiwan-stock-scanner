"""
build_stock_dict.py
一次性建立全市場股票字典，存成 stock_dict.json
之後 pipeline 直接查字典，不需每次重新抓 TWSE

執行方式：
  venv\Scripts\python.exe build_stock_dict.py

建議執行時機：
  - 第一次使用時執行一次
  - 之後每個月執行一次（補新上市股票）
"""
import json
import re
import logging
import requests
from pathlib import Path
from bs4 import BeautifulSoup

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

OUTPUT_PATH = Path(__file__).parent.parent / "frontend" / "public" / "data" / "stock_dict.json"

INDUSTRY_TO_GROUP = {
    "半導體業":           "IC設計/半導體",
    "電腦及週邊設備業":   "AI伺服器",
    "資訊服務業":         "雲端SaaS",
    "光電業":             "光電/LED",
    "通信網路業":         "5G通訊",
    "電子零組件業":       "電子零組件",
    "其他電子業":         "電子零組件",
    "電機機械":           "重電電網",
    "電器電纜":           "重電電網",
    "機械工業":           "工業自動化",
    "鋼鐵工業":           "鋼鐵",
    "塑膠工業":           "塑化",
    "化學工業":           "塑化",
    "化學及生技醫療業":   "生技醫療",
    "生技醫療業":         "生技醫療",
    "醫療器材":           "生技醫療",
    "航運業":             "航運",
    "金融保險業":         "金控銀行",
    "食品工業":           "食品飲料",
    "紡織纖維":           "紡織",
    "水泥工業":           "水泥",
    "建材營造業":         "建設營造",
    "營建業":             "建設營造",
    "觀光事業":           "觀光餐飲",
    "貿易百貨業":         "貿易零售",
    "汽車工業":           "車用電子",
    "造紙工業":           "傳產其他",
    "橡膠工業":           "傳產其他",
    "玻璃陶瓷":           "傳產其他",
    "農業科技業":         "傳產其他",
}

NAME_KEYWORD_TO_GROUP = {
    "雙鴻": "散熱",    "建準": "散熱",    "健策": "散熱",
    "奇鋐": "散熱",    "泰碩": "散熱",    "超眾": "散熱",
    "力致": "散熱",    "廣運": "散熱",    "昆盈": "散熱",
    "國巨":   "被動元件", "華新科": "被動元件", "大毅":   "被動元件",
    "禾伸堂": "被動元件", "日電貿": "被動元件", "九豪":   "被動元件",
    "立隆電": "被動元件", "晶技":   "被動元件", "信昌電": "被動元件",
    "光頡":   "被動元件",
    "金像電": "PCB載板", "志超":   "PCB載板", "柏承":   "PCB載板",
    "泰鼎":   "PCB載板", "瀚宇博": "PCB載板", "金居":   "PCB載板",
    "松普":   "PCB載板",
    "正崴": "連接器", "信邦": "連接器", "宏致": "連接器",
    "川湖": "連接器", "立敦": "連接器",
    "鴻海": "AI伺服器", "可成": "AI伺服器",
    "偉訓": "電源供應器",
    "貿聯": "線材Cable",
    "亞翔": "機電工程", "聖暉": "機電工程", "帆宣": "機電工程",
}

STOCK_OVERRIDE = {
    "2382": "AI伺服器",    "3231": "AI伺服器",
    "6669": "AI伺服器",    "3706": "AI伺服器",
    "4977": "AI伺服器",    "2324": "AI伺服器",
    "1603": "散熱",        "2351": "散熱",
    "6274": "散熱",        "8215": "散熱",
    "3008": "光電/LED",
    "4205": "CPO矽光子",   "6719": "CPO矽光子",
    "3450": "CPO矽光子",   "4979": "CPO矽光子",
    "6533": "CoWoS先進封裝","2449": "CoWoS先進封裝",
    "3035": "CoWoS先進封裝",
    "2367": "PCB載板",     "3037": "PCB載板",
    "3046": "PCB載板",     "6116": "PCB載板",
    "2049": "機器人",      "1537": "機器人",
    "3576": "太陽能",      "6244": "太陽能",
    "1513": "重電電網",    "1514": "重電電網",
    "2603": "貨櫃航運",    "2609": "貨櫃航運",
    "2615": "貨櫃航運",
    "2327": "被動元件",    "2492": "被動元件",
    "2421": "散熱",        "3324": "散熱",
    "3653": "散熱",        "2317": "AI伺服器",
}

GROUP_DESC = {
    "AI伺服器":       "AI 伺服器組裝、ODM 代工，受惠 NVIDIA/AMD GPU 需求",
    "IC設計/半導體":  "Fabless IC 設計，包含 SoC、驅動 IC、電源管理 IC",
    "散熱":           "均熱板、散熱模組、液冷系統，AI 伺服器熱管理關鍵",
    "CPO矽光子":      "共封裝光學、矽光子、光模組，AI 資料中心高速傳輸",
    "CoWoS先進封裝":  "CoWoS/SoIC 先進封裝、IC 載板，台積電供應鏈",
    "PCB載板":        "印刷電路板、ABF 載板、軟板，電子產品基礎建設",
    "被動元件":       "MLCC、電阻、電感等被動元件，電子產品必備",
    "連接器":         "線材連接器、背板連接器，資料中心與消費電子應用",
    "電子零組件":     "其他電子零組件，包含各類電子材料與模組",
    "電源供應器":     "伺服器電源、工業電源供應器",
    "線材Cable":      "高速傳輸線材、充電線，資料中心與消費電子",
    "機電工程":       "廠務機電工程、無塵室工程，半導體廠建廠受惠",
    "重電電網":       "變壓器、配電設備、電網基礎建設，台電供應商",
    "太陽能":         "太陽能電池、模組、系統，綠能轉型受惠族群",
    "風電":           "離岸風電、海底電纜，台灣再生能源政策受惠",
    "機器人":         "工業機器手臂、減速機、AMR，自動化生產趨勢",
    "工業自動化":     "CNC 工具機、工業電腦、自動化設備",
    "鋼鐵":           "熱軋、冷軋、不鏽鋼，基礎建設與製造業原料",
    "塑化":           "石化原料、塑膠製品，台塑四寶為代表",
    "生技醫療":       "新藥研發、醫療器材、CDMO 委託開發製造",
    "航運":           "散裝航運、油輪，全球大宗物資運輸",
    "貨櫃航運":       "定期貨櫃航線，長榮、陽明、萬海三大業者",
    "金控銀行":       "銀行、金控、壽險，國內金融體系核心",
    "5G通訊":         "5G 基站設備、Open RAN、無線通訊模組",
    "車用電子":       "ADAS 自駕、ECU、車用感測器，電動車趨勢",
    "食品飲料":       "食品加工、飲料製造，民生消費穩定族群",
    "光電/LED":       "LED 照明、面板、光學鏡頭、光學元件",
    "雲端SaaS":       "雲端服務、企業軟體、資料中心服務",
    "建設營造":       "不動產開發、營建工程",
    "紡織":           "紡紗、織布、機能性布料",
    "水泥":           "水泥、砂石、預拌混凝土",
    "觀光餐飲":       "觀光飯店、餐飲連鎖",
    "貿易零售":       "貿易、百貨、零售通路",
    "傳產其他":       "其他傳統產業",
    "其他/未分組":    "尚未分類或跨產業個股",
}


def assign_group(stock_id: str, name: str, industry: str) -> str:
    if stock_id in STOCK_OVERRIDE:
        return STOCK_OVERRIDE[stock_id]
    for keyword, group in NAME_KEYWORD_TO_GROUP.items():
        if keyword in name:
            return group
    for key, group in INDUSTRY_TO_GROUP.items():
        if key in industry:
            return group
    return "其他/未分組"


def fetch_all_stocks() -> dict:
    result = {}
    markets = [("2", "上市"), ("4", "上櫃")]
    for mode, market_label in markets:
        logger.info("抓取%s股票清單...", market_label)
        url = f"https://isin.twse.com.tw/isin/C_public.jsp?strMode={mode}"
        try:
            r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
            r.raise_for_status()
        except Exception as e:
            logger.error("抓取%s失敗：%s", market_label, e)
            continue
        soup = BeautifulSoup(r.text, "lxml")
        count = 0
        for row in soup.find_all("tr"):
            tds = row.find_all("td")
            if len(tds) < 5:
                continue
            cell = tds[0].text.strip()
            m = re.match(r"^(\d{4,6})\u3000(.+)$", cell)
            if not m:
                continue
            stock_id    = m.group(1)
            name        = m.group(2).strip()
            listed_date = tds[2].text.strip() if len(tds) > 2 else ""
            industry    = tds[4].text.strip() if len(tds) > 4 else ""
            if len(stock_id) != 4:
                continue
            if not industry:
                continue
            group = assign_group(stock_id, name, industry)
            result[stock_id] = {
                "name":       name,
                "industry":   industry,
                "group":      group,
                "groupDesc":  GROUP_DESC.get(group, ""),
                "market":     market_label,
                "listedDate": listed_date,
            }
            count += 1
        logger.info("%s：共 %d 支股票", market_label, count)
    return result


def build_dict():
    old_dict = {}
    if OUTPUT_PATH.exists():
        with open(OUTPUT_PATH, encoding="utf-8") as f:
            old_dict = json.load(f)
        logger.info("讀取舊字典：%d 支股票", len(old_dict))

    new_dict = fetch_all_stocks()

    new_stocks = set(new_dict.keys()) - set(old_dict.keys())
    if new_stocks:
        logger.info("發現 %d 支新股票：%s", len(new_stocks), ", ".join(sorted(new_stocks)))
    else:
        logger.info("無新上市股票")

    merged = {**old_dict, **new_dict}

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(merged, f, ensure_ascii=False, indent=2)

    logger.info("字典已寫入：%s", OUTPUT_PATH)
    logger.info("共 %d 支股票", len(merged))

    from collections import Counter
    groups = Counter(v["group"] for v in merged.values())
    logger.info("族群分布（前 20）：")
    for g, cnt in groups.most_common(20):
        logger.info("  %-22s %d 支", g, cnt)

    # 同時更新 stocks.json
    stocks_json_path = OUTPUT_PATH.parent / "stocks.json"
    if stocks_json_path.exists():
        with open(stocks_json_path, encoding="utf-8") as f:
            stocks = json.load(f)
        updated = 0
        for stock in stocks:
            info = merged.get(stock["id"])
            if info:
                stock["group"]     = info["group"]
                stock["industry"]  = info["industry"]
                stock["groupDesc"] = info["groupDesc"]
                updated += 1
        with open(stocks_json_path, "w", encoding="utf-8") as f:
            json.dump(stocks, f, ensure_ascii=False, indent=2)
        logger.info("stocks.json 同步更新：%d 筆", updated)


if __name__ == "__main__":
    build_dict()
    logger.info("完成！請重新整理瀏覽器查看結果")