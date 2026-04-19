"""
industry_mapping.py
從 TWSE 抓官方產業別，自動 mapping 到實務族群 + 產生業務說明
執行方式：venv\Scripts\python.exe industry_mapping.py
"""
import json
import re
import logging
import requests
from pathlib import Path
from bs4 import BeautifulSoup

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

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
    "國巨":  "被動元件", "華新科": "被動元件", "大毅":  "被動元件",
    "禾伸堂":"被動元件", "日電貿": "被動元件", "九豪":  "被動元件",
    "立隆電":"被動元件", "晶技":   "被動元件", "信昌電":"被動元件",
    "光頡":  "被動元件",
    "金像電":"PCB載板", "志超":  "PCB載板", "柏承":  "PCB載板",
    "泰鼎":  "PCB載板", "瀚宇博":"PCB載板", "金居":  "PCB載板",
    "松普":  "PCB載板",
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
    "傳產其他":       "其他傳統產業",
    "其他/未分組":    "尚未分類或跨產業個股",
}


def fetch_twse_industry() -> dict:
    result = {}
    for mode, label in [("2", "上市"), ("4", "上櫃")]:
        logger.info("抓取 %s 官方產業別...", label)
        url = f"https://isin.twse.com.tw/isin/C_public.jsp?strMode={mode}"
        r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
        soup = BeautifulSoup(r.text, "lxml")
        for row in soup.find_all("tr"):
            tds = row.find_all("td")
            if len(tds) < 5:
                continue
            cell = tds[0].text.strip()
            m = re.match(r"^(\d{4})\u3000(.+)$", cell)
            if not m:
                continue
            sid = m.group(1)
            name = m.group(2).strip()
            industry = tds[4].text.strip()
            if sid and industry and sid not in result:
                result[sid] = {"name": name, "industry": industry}
    logger.info("共取得 %d 支股票的產業別", len(result))
    return result


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


def update_stocks_json(industry_map: dict):
    json_path = Path(__file__).parent.parent / "frontend" / "public" / "data" / "stocks.json"
    if not json_path.exists():
        logger.error("找不到 stocks.json：%s", json_path)
        return
    with open(json_path, encoding="utf-8") as f:
        stocks = json.load(f)
    for stock in stocks:
        sid = stock["id"]
        info = industry_map.get(sid, {})
        industry = info.get("industry", "")
        name = stock.get("name", "")
        group = assign_group(sid, name, industry)
        stock["group"] = group
        stock["industry"] = industry
        stock["groupDesc"] = GROUP_DESC.get(group, "")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(stocks, f, ensure_ascii=False, indent=2)
    from collections import Counter
    groups = Counter(s["group"] for s in stocks)
    logger.info("已更新 %d 支股票 → %s", len(stocks), json_path)
    logger.info("族群分布：")
    for g, cnt in groups.most_common(20):
        logger.info("  %-22s %d 支", g, cnt)


if __name__ == "__main__":
    industry_map = fetch_twse_industry()
    update_stocks_json(industry_map)
    logger.info("完成！請重新整理瀏覽器查看結果")