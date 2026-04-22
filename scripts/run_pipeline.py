#!/usr/bin/env python3
"""
run_pipeline.py 四步驟資料管線
執行：venv\Scripts\python.exe ..\scripts\run_pipeline.py
"""
import json, logging, sys, time, re
from pathlib import Path
from datetime import datetime, timedelta
from collections import Counter

sys.path.insert(0, str(Path(__file__).parent.parent))
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

import requests
from bs4 import BeautifulSoup

DATA_DIR = Path(__file__).parent.parent / "frontend" / "public" / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = Path(__file__).parent.parent / "backend" / "db" / "stock_industry_map.json"

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}


def load_moneydj_map():
    if not DB_PATH.exists():
        logger.warning("MoneyDJ 資料庫不存在，跳過：%s", DB_PATH)
        return {}
    with open(DB_PATH, encoding="utf-8") as f:
        return json.load(f)


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


def fetch_klines(stock_ids):
    logger.info("Step 4: 抓取 K 線（%d 支）…", len(stock_ids))
    klines = {}
    for i, sid in enumerate(stock_ids):
        for suffix in [".TW", ".TWO"]:
            try:
                url = ("https://query1.finance.yahoo.com/v8/finance/chart/"
                       + sid + suffix + "?interval=1d&range=1y")
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


def calc_returns(bars):
    """回傳 5 個期間的漲幅 %: {w1, m1, m3, m6, y1}（用最後 N 個交易日）"""
    periods = {"w1": 5, "m1": 21, "m3": 65, "m6": 130, "y1": 252}
    empty = {k: None for k in periods}
    if not bars or len(bars) < 2:
        return empty
    last = bars[-1]["c"]
    if not last:
        return empty
    result = {}
    for key, days in periods.items():
        # 取最近 days+1 根 bar（起點到終點）；資料不足就用全部
        if len(bars) <= days:
            recent = bars
        else:
            recent = bars[-(days + 1):]
        first = recent[0]["c"]
        if not first:
            result[key] = None
        else:
            result[key] = round((last - first) / first * 100, 2)
    return result


def calc_3m_return(bars):
    """保留向後相容：回傳 3 月漲幅"""
    return calc_returns(bars).get("m3")


# ============================================================
# 產業別映射：backend/db/industry_categories.json
# 從 MoneyDJ 爬來的 {細產業名: 產業別名} 對應表（由 fetch_industry_hierarchy.py 產生）
# ============================================================
CATEGORY_MAP_PATH = Path(__file__).parent.parent / "backend" / "db" / "industry_categories.json"


def load_category_map():
    if not CATEGORY_MAP_PATH.exists():
        logger.warning("產業別對應表不存在：%s", CATEGORY_MAP_PATH)
        return {}
    with open(CATEGORY_MAP_PATH, encoding="utf-8") as f:
        return json.load(f)


REVENUE_PATH = Path(__file__).parent.parent / "backend" / "db" / "monthly_revenue.json"


def load_monthly_revenue():
    """回傳 {'month': 'YYYY-MM', 'data': {sid: {'yoy': ..., 'revenue': ..., 'name': ...}}}"""
    if not REVENUE_PATH.exists():
        logger.warning("月營收資料不存在：%s（跑 fetch_monthly_revenue.py 產生）", REVENUE_PATH)
        return {"month": None, "data": {}}
    with open(REVENUE_PATH, encoding="utf-8") as f:
        return json.load(f)


def refresh_monthly_revenue():
    """嘗試自動更新月營收 JSON（從 MOPS 重抓）；失敗就用既有的"""
    try:
        sys.path.insert(0, str(Path(__file__).parent))
        import fetch_monthly_revenue
        fetch_monthly_revenue.run()
    except SystemExit:
        logger.warning("月營收 scraper 呼叫 sys.exit，保留現有 monthly_revenue.json")
    except Exception as e:
        logger.warning("月營收更新失敗：%s（使用現有快取）", e)



def assign_groups(sid, moneydj_map, category_map):
    """
    用股票的 MoneyDJ 細產業查表，回傳所屬的「產業別」列表（去重、依原順序）。
    股票有多個細產業時，會在每個對應的產業別下都出現。
    """
    subs = moneydj_map.get(sid, {}).get("sub_industries", [])
    if not subs:
        return ["其他/未分類"]
    seen = set()
    result = []
    for s in subs:
        name = s.get("name", "")
        if not name:
            continue
        cat = category_map.get(name)
        if cat and cat not in seen:
            seen.add(cat)
            result.append(cat)
    if not result:
        return ["其他/未分類"]
    return result


def assign_group(sid, moneydj_map, category_map):
    return assign_groups(sid, moneydj_map, category_map)[0]


def run():
    force = any(a in ("--force", "-f") for a in sys.argv[1:])
    if force:
        logger.info("--force 指定，略過『已是最新』檢查")
    # 讀既有的 stocks.json 作為比對基礎（為了偵測「新公佈營收」）
    prev_stocks = {}
    prev_stocks_path = DATA_DIR / "stocks.json"
    if prev_stocks_path.exists():
        try:
            for old_s in json.load(open(prev_stocks_path, encoding="utf-8")):
                prev_stocks[old_s.get("id", "")] = old_s
        except Exception as e:
            logger.warning("讀既有 stocks.json 失敗（不影響流程）：%s", e)
    elif check_already_updated():
        logger.info("資料已是最新，跳過本次更新（若要強制重跑：加 --force）")
        return

    holdings = fetch_holdings()
    if not holdings:
        old_path = DATA_DIR / "stocks.json"
        if old_path.exists():
            with open(old_path, encoding="utf-8") as f:
                holdings = json.load(f)
            logger.warning("使用舊資料：%d 筆", len(holdings))
        else:
            logger.error("無法取得資料，中止")
            return

    stock_ids = list({
        h.get("id", h.get("stock_id", ""))[:4]
        for h in holdings
        if len(h.get("id", h.get("stock_id", ""))) >= 4
    })

    industry_map  = fetch_industry_map()
    moneydj_map   = load_moneydj_map()
    category_map  = load_category_map()
    refresh_monthly_revenue()  # 嘗試從 MOPS 重抓最新月營收
    revenue_map   = load_monthly_revenue()
    klines        = fetch_klines(stock_ids)

    logger.info("MoneyDJ 資料庫載入：%d 支", len(moneydj_map))
    logger.info("產業別對應表載入：%d 個細產業 → %d 個產業別",
                len(category_map), len(set(category_map.values())))
    logger.info("月營收資料月份：%s（%d 支）",
                revenue_map.get("month") or "(無)", len(revenue_map.get("data", {})))

    stocks = []
    for h in holdings:
        sid      = h.get("id", h.get("stock_id", ""))[:4]
        info     = industry_map.get(sid, {})
        name     = h.get("name") or info.get("name", "")
        industry = info.get("industry", "")
        groups   = assign_groups(sid, moneydj_map, category_map)
        bars     = klines.get(sid, [])
        returns  = calc_returns(bars)
        # 完整細產業列表（不截斷）
        all_subs = [s["name"] for s in moneydj_map.get(sid, {}).get("sub_industries", [])]
        # 每個族群（產業別）對應該股票裡的相關細產業
        subs_by_group = {}
        for sub_name in all_subs:
            cat = category_map.get(sub_name)
            if cat:
                subs_by_group.setdefault(cat, []).append(sub_name)
        rev_entry = revenue_map.get("data", {}).get(sid, {})
        # 計算 revenueFirstSeen：這個 (股票 × 月份) 組合第一次看到的日期
        curr_yoy   = rev_entry.get("yoy")
        curr_month = revenue_map.get("month")
        prev_s     = prev_stocks.get(sid, {})
        today_str  = datetime.now().strftime("%Y-%m-%d")
        if curr_yoy is None:
            revenue_first_seen = None
        elif (prev_s.get("revenueMonth") == curr_month
              and prev_s.get("revenueYoY") is not None
              and prev_s.get("revenueFirstSeen")):
            # 同一個月份的 YoY 之前就已經抓到，保留原本日期
            revenue_first_seen = prev_s.get("revenueFirstSeen")
        else:
            # 新月份，或這個月第一次抓到該股資料
            revenue_first_seen = today_str

        stocks.append({
            "id":               sid,
            "name":             name,
            "group":            groups[0],          # 主族群（向後相容）
            "groups":           groups,              # 所有相關族群
            "groupDesc":        "",
            "holdingPct":       float(h.get("holdingPct", h.get("holding_pct", 0))),
            "delta":            float(h.get("delta", 0)),
            "price":            float(bars[-1]["c"]) if bars else 0.0,
            "marketCap":        0.0,
            "date":             h.get("date", datetime.now().strftime("%Y-%m-%d")),
            "threeMonthReturn": returns.get("y1"),  # 主欄位：預設顯示 1 年漲幅
            "returns":          returns,
            "industry":         industry,
            "subIndustries":    all_subs,            # 完整列表
            "subsByGroup":      subs_by_group,       # {產業別: [該股票在此產業別下的細產業]}
            "revenueYoY":       curr_yoy,                    # 月營收年增率 %
            "revenueMonth":     curr_month,                  # 該月營收資料月份 YYYY-MM
            "revenueFirstSeen": revenue_first_seen,          # 首次抓到此月份資料的日期 YYYY-MM-DD
        })

    with open(DATA_DIR / "stocks.json", "w", encoding="utf-8") as f:
        json.dump(stocks, f, ensure_ascii=False, indent=2)
    logger.info("stocks.json：%d 筆", len(stocks))

    # 按族群拆分 klines 檔（lazy-load 用），不再寫單一 klines.json
    import urllib.parse
    klines_dir = DATA_DIR / "klines"
    # 清空舊目錄，避免累積已被移除的族群檔
    if klines_dir.exists():
        for old_file in klines_dir.glob("*.json"):
            old_file.unlink()
    klines_dir.mkdir(parents=True, exist_ok=True)

    # 蒐集每個族群應包含的股票 → klines
    group_to_stocks = {}
    for s_row in stocks:
        for g in s_row.get("groups", [s_row.get("group", "")]):
            if not g:
                continue
            group_to_stocks.setdefault(g, set()).add(s_row["id"])

    total_kb = 0
    for group_name, sid_set in group_to_stocks.items():
        subset = {sid: klines[sid] for sid in sid_set if sid in klines}
        if not subset:
            continue
        # 檔名用原始中文（只把 / 換成 _ 避開路徑分隔符）
        # 這樣 Vite/Firebase 的 URL 解碼才能對應到檔案
        safe = group_name.replace("/", "_").replace("\\", "_")
        out_path = klines_dir / f"{safe}.json"
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(subset, f, ensure_ascii=False)
        total_kb += out_path.stat().st_size // 1024
    logger.info("klines/：拆分為 %d 個族群檔，共 %d KB", len(group_to_stocks), total_kb)

    # 向後相容：保留一個完整的 klines.json（供 StockTable 全部展開用）
    # 若擔心頻寬可日後再移除，先保留
    with open(DATA_DIR / "klines.json", "w", encoding="utf-8") as f:
        json.dump(klines, f, ensure_ascii=False)
    size_kb = (DATA_DIR / "klines.json").stat().st_size // 1024
    logger.info("klines.json（備援）：%d 支，%d KB", len(klines), size_kb)

    group_counts = Counter(g for s in stocks for g in s["groups"])
    multi = sum(1 for s in stocks if len(s["groups"]) > 1)
    logger.info("族群分布（前 20，含跨族群計數）：")
    for g, cnt in group_counts.most_common(20):
        logger.info("  %-25s %d 支", g, cnt)
    logger.info("其中 %d 支股票同時屬於多個族群", multi)

    logger.info("Pipeline 完成！")


if __name__ == "__main__":
    run()