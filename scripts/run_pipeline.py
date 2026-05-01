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

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": (
        "text/html,application/xhtml+xml,application/xml;q=0.9,"
        "image/avif,image/webp,image/apng,*/*;q=0.8"
    ),
    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
    # 只用 gzip/deflate；不加 br，因為 requests 預設沒裝 brotli decoder，
    # 加了會拿到無法解壓的壓縮 bytes（symptom：HTML 看起來像亂碼）
    "Accept-Encoding": "gzip, deflate",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Cache-Control": "max-age=0",
}

# norway.twsthr.info 有時會檢查 Referer
NORWAY_HEADERS = {**HEADERS, "Referer": "https://norway.twsthr.info/"}

# 資料源常見的字元錯誤修正（norway.twsthr.info 會把某些 Big-5 字元吐成兩個錯誤字元）
# key = 錯字, value = 正字
NAME_FIX_MAP = {
    "卅卅": "碁",  # 洛碁 8077, 立碁 8111 等
}


def sanitize_name(name: str) -> str:
    """把資料源拼錯的公司名修正成正確的字"""
    if not name:
        return name
    for bad, good in NAME_FIX_MAP.items():
        name = name.replace(bad, good)
    return name



def load_moneydj_map():
    if not DB_PATH.exists():
        logger.warning("MoneyDJ 資料庫不存在，跳過：%s", DB_PATH)
        return {}
    with open(DB_PATH, encoding="utf-8") as f:
        return json.load(f)


def expected_latest_trading_day(now=None):
    """預期資料應該更新到的最近交易日（不考慮假日；14:00 TW 為切換時點）

    重要：GitHub Actions 跑在 UTC，必須強制換算成台灣時間才能正確判斷。
    本機 Windows 跑 datetime.now() 是 local time (TW)，轉一次還是 TW，沒差。
    """
    if now is None:
        # utcnow + 8 小時 = TW 時間（無論 runner 在哪個時區都 work）
        now = datetime.utcnow() + timedelta(hours=8)
    wd = now.weekday()  # 0=Mon..6=Sun
    if wd >= 5:
        # 週末：回到上週五
        return (now - timedelta(days=wd - 4)).date()
    # 平日：14:00 後算今天，之前用前一個工作日
    cutoff = now.replace(hour=14, minute=0, second=0, microsecond=0)
    if now >= cutoff:
        return now.date()
    if wd == 0:
        return (now - timedelta(days=3)).date()  # 週一早上 → 上週五
    return (now - timedelta(days=1)).date()


def check_what_needs_refresh() -> dict:
    """
    檢查哪些資料需要更新，回傳 dict：
      {"klines": bool, "holdings": bool, "revenue": bool, "financials": bool,
       "reasons": [str, ...]}
    True = 該項需要更新。reasons 是 log 用的人話說明。
    """
    result = {
        "klines": False,
        "holdings": False,
        "revenue": False,
        "financials": False,
        "reasons": [],
    }
    # 強制用台灣時間（CI 在 UTC 會判斷錯）
    now = datetime.utcnow() + timedelta(hours=8)
    today = now.date()
    expected_date = expected_latest_trading_day(now)

    # 1. K 線 / 股價：看 klines.json 最後一根 bar（格式是 YYYY/MM/DD）
    klines_path = DATA_DIR / "klines.json"
    kline_latest = None
    if klines_path.exists():
        try:
            with open(klines_path, encoding="utf-8") as f:
                kl = json.load(f)
            for sid, bars in kl.items():
                if bars:
                    last = bars[-1].get("date", "")
                    if last:
                        # 容錯：YYYY/MM/DD 或 YYYY-MM-DD 都能解析
                        for fmt in ("%Y/%m/%d", "%Y-%m-%d"):
                            try:
                                kline_latest = datetime.strptime(last, fmt).date()
                                break
                            except ValueError:
                                continue
                        if kline_latest:
                            break
        except Exception as e:
            logger.warning("讀 klines.json 失敗：%s", e)
    if kline_latest is None:
        result["klines"] = True
        result["reasons"].append("K 線資料不存在")
    elif kline_latest < expected_date:
        result["klines"] = True
        result["reasons"].append(
            f"K 線過期（最新 {kline_latest}，預期 {expected_date}）"
        )

    # 2. 大戶持股：看 stocks.json 的 date（週更，7 天內算新）
    stocks_path = DATA_DIR / "stocks.json"
    holdings_date = None
    if stocks_path.exists():
        try:
            with open(stocks_path, encoding="utf-8") as f:
                ss = json.load(f)
            if ss:
                ds = ss[0].get("date", "")
                if ds:
                    holdings_date = datetime.strptime(ds, "%Y-%m-%d").date()
        except Exception as e:
            logger.warning("讀 stocks.json 失敗：%s", e)
    if holdings_date is None:
        result["holdings"] = True
        result["reasons"].append("大戶持股資料不存在")
    else:
        days_old = (today - holdings_date).days
        if days_old >= 7:
            result["holdings"] = True
            result["reasons"].append(
                f"大戶持股超過 7 天未更新（最新 {holdings_date}，距今 {days_old} 天）"
            )

    # 3. 月營收：對照 expected_latest_revenue_month
    try:
        sys.path.insert(0, str(Path(__file__).parent))
        import fetch_financials as _ff
        exp_rev = _ff.expected_latest_revenue_month(now)
    except Exception:
        exp_rev = None
        _ff = None

    if exp_rev and REVENUE_PATH.exists():
        try:
            with open(REVENUE_PATH, encoding="utf-8") as f:
                rev = json.load(f)
            cached_month = rev.get("month") or ""
            if cached_month < exp_rev:
                result["revenue"] = True
                result["reasons"].append(
                    f"月營收過期（最新 {cached_month or '無'}，預期 {exp_rev}）"
                )
        except Exception as e:
            logger.warning("讀 monthly_revenue.json 失敗：%s", e)
    elif exp_rev:
        result["revenue"] = True
        result["reasons"].append("月營收資料不存在")

    # 4. 季報：取樣看 financials.json 各股票的 epsYoY 最後一季
    exp_q = None
    if _ff is not None:
        try:
            exp_q = _ff.expected_latest_quarter(now)
        except Exception:
            pass

    if exp_q and FINANCIALS_PATH.exists():
        try:
            with open(FINANCIALS_PATH, encoding="utf-8") as f:
                fin = json.load(f)

            # 檢查 1a：stocks.json 中有多少 ID 不在 financials（新進股完全沒抓過）
            # 檢查 1b：stocks.json 內 fundamentals 空、但 financials.json 有資料的（merge 過時）
            stocks_path = DATA_DIR / "stocks.json"
            if stocks_path.exists():
                with open(stocks_path, encoding="utf-8") as f:
                    stocks_data = json.load(f)
                stocks_ids = {s["id"] for s in stocks_data}
                fin_ids_with_data = {sid for sid, v in fin.items()
                                      if v.get("revenueYoY") or v.get("epsYoY")}

                # 1a 真的沒抓過
                missing = stocks_ids - fin_ids_with_data
                # 1b 抓過了但 stocks.json 沒 merge 進來
                stale_merge = sum(
                    1 for s in stocks_data
                    if not (s.get("fundamentals") or {}).get("revenueYoY")
                       and s["id"] in fin_ids_with_data
                )

                if len(missing) >= max(10, len(stocks_ids) * 0.05):
                    result["financials"] = True
                    result["reasons"].append(
                        f"財報資料缺漏（{len(missing)} 支股票未抓過，例：{list(missing)[:5]}）"
                    )
                elif stale_merge >= 5:
                    result["financials"] = True
                    result["reasons"].append(
                        f"財報未合進 stocks.json（{stale_merge} 支已抓但未 merge）"
                    )

            # 檢查 2：時間過期（取樣 50 支看 epsYoY 是否到最新季）
            stale_count = 0
            sample_count = 0
            for entry in list(fin.values())[:50]:
                arr = entry.get("epsYoY") or []
                if not arr:
                    continue
                sample_count += 1
                last_q = arr[-1].get("quarter", "")
                if last_q < exp_q:
                    stale_count += 1
            if sample_count > 0 and stale_count >= sample_count / 2:
                result["financials"] = True
                if not any("缺漏" in r for r in result["reasons"]):
                    result["reasons"].append(
                        f"季報過期（預期至少到 {exp_q}，取樣 {stale_count}/{sample_count} 支過期）"
                    )
        except Exception as e:
            logger.warning("讀 financials.json 失敗：%s", e)
    elif exp_q:
        result["financials"] = True
        result["reasons"].append("財報資料不存在")

    return result


def fetch_holdings():
    logger.info("Step 1: 抓取持股名單…")
    url = ("https://norway.twsthr.info/StockHoldersContinue.aspx"
           "?Show=2&continue=Y&weeks=1&growthrate=0.1"
           "&beforeweek=1&price=5000&valuerank=1-3000&display=0")
    try:
        # 用 session 維持 cookie / 連線，加 Referer，3 次 retry with backoff
        sess = requests.Session()
        # 先 GET 首頁取得任何 set-cookie（神秘金字塔有時會吐 ASP.NET_SessionId）
        try:
            sess.get("https://norway.twsthr.info/", headers=HEADERS, timeout=15)
        except Exception:
            pass

        last_err = None
        for attempt in range(3):
            try:
                r = sess.get(url, headers=NORWAY_HEADERS, timeout=30)
                r.raise_for_status()
                break
            except requests.HTTPError as e:
                last_err = e
                if e.response is not None and e.response.status_code == 403:
                    logger.warning(f"403 第 {attempt + 1} 次，等 {2 ** attempt} 秒重試")
                    time.sleep(2 ** attempt)
                    continue
                raise
        else:
            raise last_err if last_err else RuntimeError("3 次都失敗")
        soup = BeautifulSoup(r.text, "lxml")
        # 神秘金字塔現在把上市 / 上櫃拆成兩張 table，要把所有符合條件的 table 都 parse
        data_tables = []
        for t in soup.find_all("table"):
            ths = [th.text.strip() for th in t.find_all("th")]
            if any("股票" in h for h in ths) and len(t.find_all("tr")) > 10:
                data_tables.append(t)
        if not data_tables:
            logger.warning("找不到資料表格")
            return []
        logger.info("找到 %d 張資料表（上市 + 上櫃）", len(data_tables))

        # 找最新資料日期（兩張 table 通常一致，取第一個有效的）
        date_str = ""
        for dt in data_tables:
            for th in dt.find_all("th"):
                txt = th.text.strip()
                if re.match(r"^\d{8}$", txt):
                    date_str = f"{txt[:4]}-{txt[4:6]}-{txt[6:]}"
                    break
            if date_str:
                break

        # 合併所有 table 的 rows，依 stock_id 去重（保留第一筆出現的）
        rows = []
        seen_ids = set()
        for table_idx, dt in enumerate(data_tables):
            table_added = 0
            table_dup = 0
            table_skip = 0
            for tr in dt.find_all("tr"):
                tds = tr.find_all("td")
                if len(tds) < 7:
                    table_skip += 1
                    continue
                cell = tds[3].text.strip()
                m = re.match(r"^(\d{4})\s+(.+)$", cell)
                if not m:
                    table_skip += 1
                    continue
                stock_id = m.group(1)
                if stock_id in seen_ids:
                    table_dup += 1
                    continue
                try:
                    delta_text = tds[5].text.strip()
                    delta = float(delta_text)
                    col6 = tds[6].text.strip()
                    holding_pct = float(col6.replace(delta_text, "", 1))
                    # td[18] = 市值(億)；部分股票為空則回 0，後續用 FinMind fallback
                    market_cap = 0.0
                    if len(tds) > 18:
                        mc_text = tds[18].text.strip().replace(",", "")
                        if mc_text:
                            try:
                                market_cap = float(mc_text)
                            except ValueError:
                                market_cap = 0.0
                    rows.append({
                        "id": stock_id, "name": sanitize_name(m.group(2).strip()),
                        "delta": delta, "holdingPct": holding_pct,
                        "marketCap": market_cap, "date": date_str,
                    })
                    seen_ids.add(stock_id)
                    table_added += 1
                except:
                    continue
            logger.info("  table[%d]: 新增 %d 筆，重複 %d 筆，跳過 %d 列",
                        table_idx, table_added, table_dup, table_skip)
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
                        "name": sanitize_name(m.group(2).strip()),
                        "industry": tds[4].text.strip(),
                    }
        except Exception as e:
            logger.warning("產業別抓取失敗（mode=%s）：%s", mode, e)
    logger.info("產業別：%d 支", len(result))
    return result


def fetch_klines(stock_ids):
    # --skip-klines flag：從既有 klines.json 載入，不重抓
    if "--skip-klines" in sys.argv:
        cached = load_existing_klines()
        if cached is not None:
            result = {sid: cached[sid] for sid in stock_ids if sid in cached}
            logger.info("Step 4: 跳過抓取，從 cache 載入 %d/%d 支 K 線",
                        len(result), len(stock_ids))
            return result
        logger.warning("klines.json 不存在，--skip-klines 失效，正常抓取")
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
FINANCIALS_PATH = Path(__file__).parent.parent / "backend" / "db" / "financials.json"
PROFILES_PATH = Path(__file__).parent.parent / "backend" / "db" / "yahoo_profiles.json"


def load_financials():
    """讀 FinMind 抓下來的基本面資料（若不存在回空 dict）"""
    if not FINANCIALS_PATH.exists():
        logger.warning("財務資料不存在：%s（請跑 fetch_financials.py）", FINANCIALS_PATH)
        return {}
    with open(FINANCIALS_PATH, encoding="utf-8") as f:
        return json.load(f)


def load_profiles():
    """讀 Yahoo profile 資料（若不存在回空 dict）"""
    if not PROFILES_PATH.exists():
        logger.warning("Yahoo profile 不存在：%s（請跑 run_yahoo_profiles.py）", PROFILES_PATH)
        return {}
    with open(PROFILES_PATH, encoding="utf-8") as f:
        return json.load(f)


def make_company_profile(profile_raw):
    """從 yahoo_profiles 原始 dict 抽取要存進 stocks.json 的欄位（瘦身版）"""
    if not profile_raw:
        return {}
    # 只取前端要顯示的欄位（業務介紹、董監、基本資料）
    keep_fields = ["business", "chairman", "ceo", "spokesman", "deputySpokesman",
                    "foundedDate", "listedDate", "address", "phone", "fax",
                    "email", "website", "capital", "sharesOutstanding",
                    "employees", "group", "auditor", "englishName"]
    return {k: profile_raw[k] for k in keep_fields if profile_raw.get(k)}


def refresh_financials():
    """嘗試用 fetch_financials.py 增量更新（需要 .env 裡的 FINMIND_TOKEN）"""
    try:
        sys.path.insert(0, str(Path(__file__).parent))
        import fetch_financials
        fetch_financials.run()
    except SystemExit:
        logger.warning("FinMind scraper 呼叫 sys.exit，保留現有快取")
    except Exception as e:
        logger.warning("FinMind 更新失敗：%s（使用現有快取）", e)


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
    else:
        # 智能檢查：看哪些資料需要更新
        needs = check_what_needs_refresh()
        if not any([needs["klines"], needs["holdings"], needs["revenue"], needs["financials"]]):
            logger.info("✅ 所有資料皆為最新，無需更新")
            return
        logger.info("需要更新：%s", "；".join(needs["reasons"]))
        # 若只有 K 線過期、其他都 fresh → 跑輕量 update_klines.py 就好
        only_klines = (
            needs["klines"]
            and not needs["holdings"]
            and not needs["revenue"]
            and not needs["financials"]
        )
        if only_klines:
            logger.info("→ 只有 K 線過期，改跑輕量 update_klines.py")
            try:
                sys.path.insert(0, str(Path(__file__).parent))
                import update_klines
                update_klines.run()
            except Exception as e:
                logger.warning("update_klines 失敗：%s，fallback 跑完整 pipeline", e)
            else:
                return

    # 讀既有的 stocks.json 作為比對基礎（為了偵測「新公佈營收」）
    prev_stocks = {}
    prev_stocks_path = DATA_DIR / "stocks.json"
    if prev_stocks_path.exists():
        try:
            for old_s in json.load(open(prev_stocks_path, encoding="utf-8")):
                prev_stocks[old_s.get("id", "")] = old_s
        except Exception as e:
            logger.warning("讀既有 stocks.json 失敗（不影響流程）：%s", e)

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
    refresh_financials()       # 嘗試用 FinMind 更新 12 月營收 + 8 季財報
    financials    = load_financials()
    profiles      = load_profiles()
    klines        = fetch_klines(stock_ids)

    # 神秘金字塔抓不到市值的股票，用 FinMind CommonStocks 反推
    missing_cap_ids = [
        h.get("id", h.get("stock_id", ""))[:4]
        for h in holdings
        if not float(h.get("marketCap", 0) or 0)
    ]
    common_stocks_map = {}
    if missing_cap_ids:
        logger.info("神秘金字塔沒市值的有 %d 支，用 FinMind fallback", len(missing_cap_ids))
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            import fetch_common_stocks
            common_stocks_cache = fetch_common_stocks.refresh(missing_cap_ids)
            common_stocks_map = {
                sid: (e.get("common_stocks") or 0)
                for sid, e in common_stocks_cache.items()
            }
        except Exception as e:
            logger.warning("FinMind common_stocks fallback 失敗：%s", e)

    logger.info("MoneyDJ 資料庫載入：%d 支", len(moneydj_map))
    logger.info("產業別對應表載入：%d 個細產業 → %d 個產業別",
                len(category_map), len(set(category_map.values())))
    logger.info("月營收資料月份：%s（%d 支）",
                revenue_map.get("month") or "(無)", len(revenue_map.get("data", {})))
    logger.info("基本面資料：%d 支股票有 FinMind 快取", len(financials))

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

        # 市值（億）：優先從 holdings 帶；沒有時用 FinMind common_stocks × 股價 / 1e8
        price_now = float(bars[-1]["c"]) if bars else 0.0
        market_cap = float(h.get("marketCap", 0.0))
        if not market_cap and sid in common_stocks_map and price_now:
            shares = common_stocks_map[sid] / 10  # 面額 10 元
            market_cap = round((shares * price_now) / 1e8, 2)

        # 成交值（億元）：用 typical price 近似
        # typical_price = (high + low + close) / 3，比單純 close 更接近 VWAP
        # d1=當日；d5=週均；d10=雙週均；d20=月均
        def _bar_turnover(b):
            h = b.get("h") or 0
            l = b.get("l") or 0
            c = b.get("c") or 0
            v = b.get("v") or 0
            tp = (h + l + c) / 3 if (h and l and c) else c
            return tp * v
        turnovers = {}
        volumes = {}
        if bars:
            # d50 ≈ 10 週均（5 days/wk × 10）
            for label, days in [("d1", 1), ("d5", 5), ("d10", 10), ("d20", 20), ("d50", 50)]:
                recent = bars[-days:] if len(bars) >= days else bars
                total = sum(_bar_turnover(b) for b in recent)
                turnovers[label] = round(total / len(recent) / 1e8, 2)
                # 成交量（千張）：v 是股，÷ 1e6 = 千張
                total_v = sum((b.get("v") or 0) for b in recent)
                volumes[label] = round(total_v / len(recent) / 1e6, 2)
        else:
            turnovers = {"d1": 0, "d5": 0, "d10": 0, "d20": 0, "d50": 0}
            volumes   = {"d1": 0, "d5": 0, "d10": 0, "d20": 0, "d50": 0}

        # 52 週新高百分比
        pct_of_52w_high = None
        if bars and price_now:
            recent252 = bars[-252:] if len(bars) >= 252 else bars
            highs = [b.get("h") or b.get("c") or 0 for b in recent252]
            high52w = max(highs) if highs else 0
            if high52w > 0:
                pct_of_52w_high = round(price_now / high52w * 100, 2)

        # 200 日新高（給選股 2 條件 03）
        pct_of_200d_high = None
        if bars and price_now:
            recent200 = bars[-200:] if len(bars) >= 200 else bars
            highs200 = [b.get("h") or b.get("c") or 0 for b in recent200]
            high200d = max(highs200) if highs200 else 0
            if high200d > 0:
                pct_of_200d_high = round(price_now / high200d * 100, 2)

        # 均線 MA10 / MA20 / MA60
        def _ma_local(n):
            if not bars or len(bars) < n: return None
            return round(sum((b.get("c") or 0) for b in bars[-n:]) / n, 2)
        ma10 = _ma_local(10)
        ma20 = _ma_local(20)
        ma60 = _ma_local(60)

        # 20MA 朝上：今日 ma20 vs 5 個交易日前的 ma20
        ma20_trend = None
        if bars and len(bars) >= 25 and ma20 is not None:
            ma20_5d_ago = round(sum((b.get("c") or 0) for b in bars[-25:-5]) / 20, 2)
            ma20_trend = "up" if ma20 > ma20_5d_ago else ("down" if ma20 < ma20_5d_ago else "flat")

        # 今日單日漲跌幅 %
        daily_change_pct = None
        if bars and len(bars) >= 2:
            prev_c = bars[-2].get("c") or 0
            if prev_c > 0 and price_now:
                daily_change_pct = round((price_now - prev_c) / prev_c * 100, 2)

        stocks.append({
            "id":               sid,
            "name":             name,
            "group":            groups[0],          # 主族群（向後相容）
            "groups":           groups,              # 所有相關族群
            "groupDesc":        "",
            "holdingPct":       float(h.get("holdingPct", h.get("holding_pct", 0))),
            "delta":            float(h.get("delta", 0)),
            "price":            price_now,
            "marketCap":        market_cap,
            "turnovers":        turnovers,            # 多期間成交值（億元）：d1/d5/d10/d20/d50
            "volumes":          volumes,              # 多期間成交量（千張）：d1/d5/d10/d20/d50
            "pctOf52wHigh":     pct_of_52w_high,      # 現價 / 52週最高 ×100
            "pctOf200dHigh":    pct_of_200d_high,     # 現價 / 200日最高 ×100
            "ma10":             ma10,
            "ma20":             ma20,
            "ma60":             ma60,
            "ma20Trend":        ma20_trend,           # "up" / "down" / "flat"
            "dailyChangePct":   daily_change_pct,     # 今日漲跌幅 %
            "date":             h.get("date", datetime.now().strftime("%Y-%m-%d")),
            "threeMonthReturn": returns.get("y1"),  # 主欄位：預設顯示 1 年漲幅
            "returns":          returns,
            "industry":         industry,
            "subIndustries":    all_subs,            # 完整列表
            "subsByGroup":      subs_by_group,       # {產業別: [該股票在此產業別下的細產業]}
            "revenueYoY":       curr_yoy,                    # 月營收年增率 %
            "revenueMonth":     curr_month,                  # 該月營收資料月份 YYYY-MM
            "revenueFirstSeen": revenue_first_seen,          # 首次抓到此月份資料的日期 YYYY-MM-DD
            "fundamentals":     financials.get(sid, {}),     # FinMind 12 個月/8 季 YoY 序列
            "companyProfile":   make_company_profile(profiles.get(sid)),  # Yahoo 公司基本資料 + 業務介紹
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


def load_existing_klines():
    """從 frontend/public/data/klines.json 載入既有 K 線（給 --skip-klines 用）"""
    path = Path(__file__).parent.parent / "frontend" / "public" / "data" / "klines.json"
    if not path.exists():
        logger.warning("klines.json 不存在，無法 skip K 線；將正常抓取")
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        logger.info("Step 4: 跳過 K 線抓取，從現有 klines.json 載入：%d 支", len(data))
        return data
    except Exception as e:
        logger.warning("讀取 klines.json 失敗：%s；將正常抓取", e)
        return None


if __name__ == "__main__":
    run()