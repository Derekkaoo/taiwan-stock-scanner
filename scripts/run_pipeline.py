#!/usr/bin/env python3
"""
run_pipeline.py — 完整資料管線（含自動偵測來源是否更新）
執行：venv\Scripts\python.exe ..\scripts\run_pipeline.py
"""
import json, logging, sys, time, re
from pathlib import Path
from datetime import datetime, timedelta

sys.path.insert(0, str(Path(__file__).parent.parent))
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

import requests
from bs4 import BeautifulSoup

DATA_DIR = Path(__file__).parent.parent / "frontend" / "public" / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

STOCK_OVERRIDE = {
    "2382":"AI伺服器",  "3231":"AI伺服器",  "6669":"AI伺服器",
    "3706":"AI伺服器",  "2317":"AI伺服器",  "4977":"AI伺服器",
    "2324":"AI伺服器",  "2356":"AI伺服器",
    "1603":"散熱",      "2351":"散熱",      "6274":"散熱",
    "8215":"散熱",      "2421":"散熱",      "3324":"散熱",
    "3017":"散熱",      "3653":"散熱",
    "3008":"光學/鏡頭",
    "6116":"光電/LED",
    "4205":"CPO矽光子", "6719":"CPO矽光子", "3450":"CPO矽光子",
    "4979":"CPO矽光子",
    "6533":"CoWoS先進封裝", "2449":"CoWoS先進封裝", "3035":"CoWoS先進封裝",
    "2367":"PCB載板",   "3037":"PCB載板",   "3046":"PCB載板",
    "2049":"機器人",    "1537":"機器人",
    "3576":"太陽能",    "6244":"太陽能",
    "1513":"重電電網",  "1514":"重電電網",
    "2603":"貨櫃航運",  "2609":"貨櫃航運",  "2615":"貨櫃航運",
    "2327":"被動元件",  "2492":"被動元件",
}

NAME_KEYWORD = {
    "雙鴻":"散熱",   "建準":"散熱",   "健策":"散熱",   "奇鋐":"散熱",
    "超眾":"散熱",   "泰碩":"散熱",
    "國巨":"被動元件","華新科":"被動元件","大毅":"被動元件",
    "禾伸堂":"被動元件","立隆電":"被動元件",
    "金像電":"PCB載板","志超":"PCB載板","柏承":"PCB載板","泰鼎":"PCB載板",
    "正崴":"連接器", "信邦":"連接器",  "宏致":"連接器",
    "鴻海":"AI伺服器","可成":"AI伺服器",
    "偉訓":"電源供應器",
    "貿聯":"線材Cable",
    "亞翔":"機電工程","聖暉":"機電工程",
}

INDUSTRY_TO_GROUP = {
    "半導體業":"IC設計/半導體",
    "電腦及週邊設備業":"AI伺服器",
    "光電業":"光電/LED",
    "通信網路業":"5G通訊",
    "電子零組件業":"電子零組件",
    "其他電子業":"電子零組件",
    "電機機械":"重電電網",
    "電器電纜":"重電電網",
    "機械工業":"工業自動化",
    "鋼鐵工業":"鋼鐵",
    "塑膠工業":"塑化",
    "化學工業":"塑化",
    "生技醫療業":"生技醫療",
    "醫療器材":"生技醫療",
    "航運業":"航運",
    "金融保險業":"金控銀行",
    "食品工業":"食品飲料",
    "紡織纖維":"紡織",
    "水泥工業":"水泥",
    "建材營造業":"建設營造",
    "營建業":"建設營造",
}

STATEMENTDOG_TAGS = {
    "5509":"AI伺服器",   "1475":"AI伺服器",   "826":"AI伺服器",
    "489":"散熱",        "19887":"散熱",
    "19288":"CPO矽光子", "10405":"CPO矽光子", "48029":"CPO矽光子",
    "1468":"CoWoS先進封裝","15964":"CoWoS先進封裝",
    "351":"PCB載板",     "957":"PCB載板",      "410":"PCB載板",
    "172":"被動元件",
    "194":"連接器",
    "977":"記憶體DRAM",
    "1412":"IC設計/半導體","2163":"IC設計/半導體",
    "101":"晶圓代工",    "946":"晶圓代工",
    "1440":"電源供應器", "8471":"電源供應器",
    "366":"重電電網",    "540":"重電電網",     "577":"重電電網",
    "1450":"機器人",     "12760":"機器人",     "2207":"機器人",
    "306":"工業自動化",
    "653":"太陽能",      "5917":"太陽能",
    "1477":"5G通訊",     "321":"5G通訊",
    "66":"車用電子",     "197":"車用電子",
    "273":"光學/鏡頭",   "491":"光學/鏡頭",
    "320":"光電/LED",    "357":"光電/LED",
    "1452":"低軌衛星",   "376":"低軌衛星",
}

GROUP_DESC = {
    "AI伺服器":       "AI 伺服器組裝、ODM 代工，受惠 NVIDIA/AMD GPU 需求",
    "IC設計/半導體":  "Fabless IC 設計，包含 SoC、驅動 IC、電源管理 IC",
    "晶圓代工":       "晶圓代工，台積電、聯電等",
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
    "光學/鏡頭":      "光學鏡頭、鏡片，手機與工業應用",
    "雲端SaaS":       "雲端服務、企業軟體、資料中心服務",
    "建設營造":       "不動產開發、營建工程",
    "記憶體DRAM":     "DRAM、Flash 記憶體製造",
    "低軌衛星":       "低軌衛星通訊、SpaceX Starlink 供應鏈",
    "紡織":           "紡紗、織布、機能性布料",
    "水泥":           "水泥、砂石、預拌混凝土",
    "傳產其他":       "其他傳統產業",
    "其他/未分組":    "尚未分類或跨產業個股",
}


def assign_group(sid, name, industry, sd_map):
    if sid in STOCK_OVERRIDE:
        return STOCK_OVERRIDE[sid]
    if sid in sd_map:
        return sd_map[sid]
    for k, v in NAME_KEYWORD.items():
        if k in name:
            return v
    for k, v in INDUSTRY_TO_GROUP.items():
        if k in industry:
            return v
    return "其他/未分組"


def check_already_updated() -> bool:
    stocks_path = DATA_DIR / "stocks.json"
    if not stocks_path.exists():
        return False
    try:
        with open(stocks_path, encoding="utf-8") as f:
            stocks = json.load(f)
        if not stocks:
            return False
        latest_date_str = stocks[0].get("date", "")
        if not latest_date_str:
            return False
        latest_date = datetime.strptime(latest_date_str, "%Y-%m-%d")
        today = datetime.now()
        days_since_friday = (today.weekday() - 4) % 7
        last_friday = today - timedelta(days=days_since_friday)
        last_friday = last_friday.replace(hour=0, minute=0, second=0, microsecond=0)
        logger.info("現有資料日期：%s，本週五：%s", latest_date_str, last_friday.strftime("%Y-%m-%d"))
        if latest_date >= last_friday:
            logger.info("資料已是本週最新，跳過更新")
            return True
        logger.info("資料尚未更新到本週，繼續執行 pipeline")
        return False
    except Exception as e:
        logger.warning("檢查日期失敗：%s，繼續執行", e)
        return False


def fetch_holdings():
    logger.info("Step 1: 抓取持股名單…")
    url = ("https://norway.twsthr.info/StockHoldersContinue.aspx"
           "?Show=2&continue=Y&weeks=1&growthrate=0.1"
           "&beforeweek=1&price=5000&valuerank=1-3000&display=0")
    try:
        r = requests.get(url, headers=HEADERS, timeout=30)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "lxml")
        data_table = None
        for t in soup.find_all("table"):
            ths = [th.text.strip() for th in t.find_all("th")]
            if any("股票" in h for h in ths) and len(t.find_all("tr")) > 10:
                data_table = t
        if not data_table:
            logger.warning("找不到資料表格")
            return []
        date_str = ""
        for th in data_table.find_all("th"):
            txt = th.text.strip()
            if re.match(r"^\d{8}$", txt):
                date_str = f"{txt[:4]}-{txt[4:6]}-{txt[6:]}"
                break
        rows = []
        for tr in data_table.find_all("tr"):
            tds = tr.find_all("td")
            if len(tds) < 7:
                continue
            cell = tds[3].text.strip()
            m = re.match(r"^(\d{4})\s+(.+)$", cell)
            if not m:
                continue
            try:
                delta_text = tds[5].text.strip()
                delta = float(delta_text)
                col6 = tds[6].text.strip()
                holding_pct = float(col6.replace(delta_text, "", 1))
                rows.append({
                    "id": m.group(1), "name": m.group(2).strip(),
                    "delta": delta, "holdingPct": holding_pct, "date": date_str,
                })
            except:
                continue
        logger.info("持股名單：%d 筆，資料日期：%s", len(rows), date_str)
        return rows
    except Exception as e:
        logger.error("持股名單抓取失敗：%s", e)
        return []


def fetch_industry_map():
    logger.info("Step 2: 抓取官方產業別…")
    result = {}
    for mode in ["2", "4"]:
        try:
            r = requests.get(
                f"https://isin.twse.com.tw/isin/C_public.jsp?strMode={mode}",
                headers=HEADERS, timeout=30,
            )
            soup = BeautifulSoup(r.text, "lxml")
            for row in soup.find_all("tr"):
                tds = row.find_all("td")
                if len(tds) < 5:
                    continue
                m = re.match(r"^(\d{4})\u3000(.+)$", tds[0].text.strip())
                if not m:
                    continue
                sid = m.group(1)
                if sid not in result:
                    result[sid] = {
                        "name": m.group(2).strip(),
                        "industry": tds[4].text.strip(),
                    }
        except Exception as e:
            logger.warning("產業別抓取失敗（mode=%s）：%s", mode, e)
    logger.info("產業別：%d 支", len(result))
    return result


def fetch_statementdog_map():
    logger.info("Step 3: 抓取財報狗族群（全市場）…")
    sd_map = {}
    total = len(STATEMENTDOG_TAGS)
    for i, (tag_id, group_name) in enumerate(STATEMENTDOG_TAGS.items(), 1):
        try:
            r = requests.get(
                f"https://statementdog.com/tags/{tag_id}",
                headers=HEADERS, timeout=15,
            )
            if r.status_code != 200:
                continue
            soup = BeautifulSoup(r.text, "lxml")
            for a in soup.find_all("a", href=True):
                href = a["href"]
                if "/analysis/" not in href:
                    continue
                for p in href.split("/"):
                    if len(p) == 4 and p.isdigit():
                        if p not in sd_map:
                            sd_map[p] = group_name
        except Exception as e:
            logger.debug("tag %s 失敗：%s", tag_id, e)
        if i % 10 == 0:
            logger.info("  財報狗進度：%d/%d，已 mapping %d 支", i, total, len(sd_map))
        time.sleep(0.5)
    logger.info("財報狗 mapping 完成：共 %d 支", len(sd_map))
    return sd_map


def fetch_klines(stock_ids):
    logger.info("Step 4: 抓取 K 線（%d 支）…", len(stock_ids))
    klines = {}
    for i, sid in enumerate(stock_ids):
        for suffix in [".TW", ".TWO"]:
            try:
                url = ("https://query1.finance.yahoo.com/v8/finance/chart/"
                       + sid + suffix + "?interval=1d&range=3mo")
                r = requests.get(url, headers=HEADERS, timeout=10)
                if not r.ok:
                    continue
                data = r.json()
                result = data.get("chart", {}).get("result", [None])[0]
                if not result:
                    continue
                timestamps = result.get("timestamp", [])
                ohlcv = result.get("indicators", {}).get("quote", [{}])[0]
                bars = []
                for j, ts in enumerate(timestamps):
                    c = ohlcv.get("close", [None])[j]
                    if c is None:
                        continue
                    bars.append({
                        "date": time.strftime("%Y/%m/%d", time.localtime(ts)),
                        "o": round(ohlcv.get("open",   [0])[j] or 0, 2),
                        "h": round(ohlcv.get("high",   [0])[j] or 0, 2),
                        "l": round(ohlcv.get("low",    [0])[j] or 0, 2),
                        "c": round(c, 2),
                        "v": ohlcv.get("volume", [0])[j] or 0,
                    })
                if len(bars) >= 5:
                    klines[sid] = bars
                    break
            except:
                continue
        if i % 20 == 0 and i > 0:
            logger.info("  K 線進度：%d/%d", i, len(stock_ids))
        time.sleep(0.15)
    logger.info("K 線取得：%d 支", len(klines))
    return klines


def calc_3m_return(bars):
    if not bars or len(bars) < 2:
        return None
    return round((bars[-1]["c"] - bars[0]["c"]) / bars[0]["c"] * 100, 2)


def run():
    if check_already_updated():
        logger.info("本次執行跳過（資料已是最新）")
        return

    holdings = fetch_holdings()
    if not holdings:
        old_path = DATA_DIR / "stocks.json"
        if old_path.exists():
            with open(old_path, encoding="utf-8") as f:
                holdings = json.load(f)
            logger.warning("使用舊資料（%d 筆）", len(holdings))
        else:
            logger.error("無資料可用，終止")
            return

    stock_ids = list({
        h.get("id", h.get("stock_id", ""))[:4]
        for h in holdings
        if len(h.get("id", h.get("stock_id", ""))) >= 4
    })

    industry_map = fetch_industry_map()
    sd_map = fetch_statementdog_map()
    klines = fetch_klines(stock_ids)

    stocks = []
    for h in holdings:
        sid = h.get("id", h.get("stock_id", ""))[:4]
        info = industry_map.get(sid, {})
        name = h.get("name") or info.get("name", "")
        industry = info.get("industry", "")
        group = assign_group(sid, name, industry, sd_map)
        bars = klines.get(sid, [])
        stocks.append({
            "id":               sid,
            "name":             name,
            "group":            group,
            "groupDesc":        GROUP_DESC.get(group, ""),
            "holdingPct":       float(h.get("holdingPct", h.get("holding_pct", 0))),
            "delta":            float(h.get("delta", 0)),
            "price":            float(bars[-1]["c"]) if bars else 0.0,
            "marketCap":        0.0,
            "date":             h.get("date", datetime.now().strftime("%Y-%m-%d")),
            "threeMonthReturn": calc_3m_return(bars),
            "industry":         industry,
        })

    with open(DATA_DIR / "stocks.json", "w", encoding="utf-8") as f:
        json.dump(stocks, f, ensure_ascii=False, indent=2)
    logger.info("stocks.json：%d 筆", len(stocks))

    with open(DATA_DIR / "klines.json", "w", encoding="utf-8") as f:
        json.dump(klines, f, ensure_ascii=False)
    size_kb = (DATA_DIR / "klines.json").stat().st_size // 1024
    logger.info("klines.json：%d 支，%d KB", len(klines), size_kb)

    from collections import Counter
    groups = Counter(s["group"] for s in stocks)
    logger.info("族群分布（前 15）：")
    for g, cnt in groups.most_common(15):
        logger.info("  %-22s %d 支", g, cnt)

    logger.info("Pipeline 完成！")


if __name__ == "__main__":
    run()