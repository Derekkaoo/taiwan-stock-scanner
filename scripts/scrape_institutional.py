"""
scrape_institutional.py — 抓三大法人買賣超

資料源：FinMind API
  dataset = TaiwanStockInstitutionalInvestorsBuySell
  每天每支股票會有多筆紀錄（外資、投信、自營商各一筆），需用 stock_id + name 分組

每日跑：
  - 從 stocks.json 讀現有股票清單
  - 撈最近 N 個交易日的三大法人資料
  - 整理 → backend/db/institutional.json

JSON 結構：
  {
    "updated":  "2026-04-26T19:00:00",
    "by_stock": {
      "2330": [
        {"date": "2026-04-25", "foreign": 12345, "trust": 678, "dealer": -123},
        ...                       # 最多 KEEP_DAYS 筆
      ],
      ...
    }
  }
單位：張（1 張 = 1000 股）— 後端轉好，正 = 買超、負 = 賣超

用法：
  python scripts/scrape_institutional.py
"""
import json
import logging
import os
import sys
import time
from collections import defaultdict
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

# 讀 .env
ENV_PATH = Path(__file__).parent.parent / ".env"
if ENV_PATH.exists():
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

TOKEN = os.environ.get("FINMIND_TOKEN", "").strip()

API = "https://api.finmindtrade.com/api/v4/data"

DATA_DIR = Path(__file__).parent.parent / "frontend" / "public" / "data"
DB_DIR   = Path(__file__).parent.parent / "backend" / "db"
OUT_PATH = DB_DIR / "institutional.json"

KEEP_DAYS = 30          # 保留最近 N 個交易日
LOOKBACK_DAYS = 30      # FinMind 撈幾天往前
USER_AGENT = "Mozilla/5.0"


# 三大法人 name 對應：FinMind 用中文 + 細項，這裡 normalize 成 3 大類
def _classify_name(name: str) -> str | None:
    """name 字串 → 'foreign' / 'trust' / 'dealer' / None（其他細項忽略）"""
    if not name:
        return None
    n = name.strip()
    # 外資（含外國自然人、外國法人、不含外資自營商）
    if n in ("Foreign_Investor", "外資", "外資及陸資", "外資及陸資(不含外資自營商)",
             "Foreign_Dealer_Self"):  # 注意：有時會分開
        return "foreign"
    # 投信
    if n in ("Investment_Trust", "投信"):
        return "trust"
    # 自營商
    if n in ("Dealer", "自營商", "Dealer_self", "Dealer_Hedging",
             "自營商(自行買賣)", "自營商(避險)"):
        return "dealer"
    return None


def fetch_finmind(stock_id: str, start_date: str):
    """抓單支股票最近的三大法人資料。回傳 list of records 或 None"""
    params = {
        "dataset":    "TaiwanStockInstitutionalInvestorsBuySell",
        "data_id":    stock_id,
        "start_date": start_date,
    }
    if TOKEN:
        params["token"] = TOKEN
    try:
        r = requests.get(API, params=params, timeout=30,
                         headers={"User-Agent": USER_AGENT})
        if r.status_code == 402:
            logger.warning("[%s] FinMind 402 額度用完", stock_id)
            return None
        if r.status_code != 200:
            logger.debug("[%s] FinMind HTTP %d", stock_id, r.status_code)
            return None
        j = r.json()
        if j.get("status") != 200:
            return None
        return j.get("data") or []
    except Exception as e:
        logger.debug("[%s] FinMind 例外：%s", stock_id, e)
        return None


def normalize_records(records: list[dict]) -> dict[str, dict]:
    """records → {date: {foreign, trust, dealer}}（單位：張）"""
    by_date = defaultdict(lambda: {"foreign": 0, "trust": 0, "dealer": 0})
    for r in records or []:
        date = r.get("date")
        cat  = _classify_name(r.get("name", ""))
        if not date or not cat:
            continue
        # FinMind: buy / sell 都是「股」，net = (buy - sell)；轉「張」 ÷1000
        buy  = r.get("buy")  or 0
        sell = r.get("sell") or 0
        try:
            net = (int(buy) - int(sell)) / 1000.0
        except (TypeError, ValueError):
            continue
        # 同類別累加（外資自營商 + 一般外資 都計入 foreign）
        by_date[date][cat] += round(net)
    return dict(by_date)


# ============================================================
# TWSE / TPEx 官方 API（無額度限制，用作 FinMind fallback）
# ============================================================

def fetch_twse_t86(date_str: str) -> dict:
    """抓 TWSE 上市 三大法人 batch（一個 call 拿全部）。
    date_str: YYYY-MM-DD 或 YYYYMMDD。
    回傳 {stock_id: {foreign, trust, dealer}}（單位：張）。"""
    yyyymmdd = date_str.replace("-", "")
    url = "https://www.twse.com.tw/rwd/zh/fund/T86"
    params = {"date": yyyymmdd, "selectType": "ALL", "response": "json"}
    try:
        r = requests.get(url, params=params, timeout=30,
                         headers={"User-Agent": USER_AGENT})
        if r.status_code != 200:
            logger.warning("TWSE T86 HTTP %d (date=%s)", r.status_code, date_str)
            return {}
        j = r.json()
    except Exception as e:
        logger.warning("TWSE T86 fetch %s 失敗: %s", date_str, e)
        return {}

    if j.get("stat") != "OK":
        logger.warning("TWSE T86 stat=%s（%s 可能非交易日 / 尚未公布）",
                       j.get("stat"), date_str)
        return {}

    data = j.get("data") or []
    result = {}
    # 欄位固定位置（驗證過 2026 格式）：
    # 0=代號 1=名稱 2~4=外陸資買進/賣出/淨額 5~7=外資自營商買進/賣出/淨額
    # 8~10=投信買進/賣出/淨額 11=自營商淨額(合計)
    # 12~14=自營商自行買進/賣出/淨額 15~17=自營商避險買進/賣出/淨額
    # 18=三大法人合計
    for row in data:
        if not isinstance(row, list) or len(row) < 12:
            continue
        try:
            sid = str(row[0]).strip()
            foreign_shares = int(str(row[4]).replace(",", ""))   # 外陸資淨額（不含外資自營商）
            trust_shares   = int(str(row[10]).replace(",", ""))  # 投信淨額
            dealer_shares  = int(str(row[11]).replace(",", ""))  # 自營商淨額（合計）
        except (ValueError, AttributeError):
            continue
        if not sid:
            continue
        # 股 → 張（FinMind 數據也是張，保持一致）
        result[sid] = {
            "foreign": round(foreign_shares / 1000),
            "trust":   round(trust_shares / 1000),
            "dealer":  round(dealer_shares / 1000),
        }
    return result


def fetch_tpex_3insti(date_str: str) -> dict:
    """抓 TPEx 上櫃 三大法人 batch。
    回傳 {stock_id: {foreign, trust, dealer}}（單位：張）。
    TPEx OpenAPI 只給最新一天，所以 date_str 只用來 log；若不是最新日，回空。"""
    url = "https://www.tpex.org.tw/openapi/v1/tpex_3insti_daily_trade"
    try:
        r = requests.get(url, timeout=30,
                         headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
                         allow_redirects=True)
        if r.status_code != 200:
            logger.warning("TPEx OpenAPI HTTP %d", r.status_code)
            return {}
        # TPEx 有時 content-type 不是 json，要強制解
        try:
            data = r.json()
        except Exception:
            import json as _json
            data = _json.loads(r.text)
    except Exception as e:
        logger.warning("TPEx OpenAPI fetch 失敗: %s", e)
        return {}

    if not isinstance(data, list) or not data:
        return {}

    # TPEx OpenAPI 欄位名（已知幾種變體都試一遍）
    def _get(row, *keys):
        for k in keys:
            if k in row:
                v = row[k]
                if v is not None and v != "":
                    return v
        return "0"

    # TPEx 日期欄常用 ROC 民國年（115/04/24）— 用來 sanity check
    sample = data[0]
    sample_date = _get(sample, "Date", "date", "資料日期", "Trade_Date")
    logger.info("TPEx OpenAPI 樣本日期: %s, 共 %d 筆", sample_date, len(data))

    result = {}
    for row in data:
        try:
            sid = str(_get(row, "SecuritiesCompanyCode", "Code", "證券代號", "code")).strip()
            if not sid:
                continue
            # 外資（不含外資自營商）淨額
            foreign = int(str(_get(row,
                "ForeignInvestorsNetBuySell",
                "ForeignTotalNetBuySell",
                "外陸資買賣超股數(不含外資自營商)",
                "foreignNet",
            )).replace(",", "") or 0)
            trust = int(str(_get(row,
                "InvestmentTrustNetBuySell",
                "TrustNetBuySell",
                "投信買賣超股數",
            )).replace(",", "") or 0)
            ds = int(str(_get(row,
                "DealerNetBuySellselftrade",
                "DealerSelfNetBuySell",
                "自營商買賣超股數(自行買賣)",
            )).replace(",", "") or 0)
            dh = int(str(_get(row,
                "DealerNetBuySellHedge",
                "DealerHedgeNetBuySell",
                "自營商買賣超股數(避險)",
            )).replace(",", "") or 0)
            dealer = ds + dh
        except (ValueError, AttributeError):
            continue
        # TPEx 數據單位通常是「股」（跟 TWSE 一致）
        result[sid] = {
            "foreign": round(foreign / 1000),
            "trust":   round(trust / 1000),
            "dealer":  round(dealer / 1000),
        }
    return result


def fetch_official_for_date(date_str: str) -> dict:
    """TWSE + TPEx 合併，一次拿全部上市櫃 三大法人資料。
    回傳 {stock_id: {foreign, trust, dealer}}。"""
    twse = fetch_twse_t86(date_str)
    tpex = {}
    try:
        tpex = fetch_tpex_3insti(date_str)
    except Exception as e:
        logger.warning("TPEx fetch 異常: %s", e)
    logger.info("Official APIs 抓到：TWSE %d 支 / TPEx %d 支（date=%s）",
                len(twse), len(tpex), date_str)
    return {**twse, **tpex}


def merge_day_into_cache(by_stock: dict, date_str: str, day_data: dict) -> int:
    """把單日的資料 merge 進 by_stock 歷史。回傳新增/覆蓋筆數。"""
    touched = 0
    for sid, vals in day_data.items():
        history = by_stock.get(sid) or []
        existing_dates = {h["date"] for h in history}
        if date_str in existing_dates:
            for h in history:
                if h["date"] == date_str:
                    h.update(vals)
                    break
        else:
            history.append({"date": date_str, **vals})
            history.sort(key=lambda x: x.get("date", ""))
            history = history[-KEEP_DAYS:]
        by_stock[sid] = history
        touched += 1
    return touched


# ============================================================


def load_stock_ids() -> list[str]:
    p = DATA_DIR / "stocks.json"
    if not p.exists():
        logger.error("stocks.json 不存在 — 先跑 run_pipeline / update_klines")
        return []
    raw = json.loads(p.read_text(encoding="utf-8"))
    return [s["id"] for s in raw]


def load_existing() -> dict:
    if not OUT_PATH.exists():
        return {"updated": "", "by_stock": {}}
    try:
        return json.loads(OUT_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {"updated": "", "by_stock": {}}


def run():
    if not TOKEN:
        logger.warning("無 FINMIND_TOKEN — 仍可嘗試（免費版有限制）")

    stock_ids = load_stock_ids()
    if not stock_ids:
        return 1

    db = load_existing()
    by_stock = db.get("by_stock") or {}

    # smart-skip：用「cache 中最新一筆 date」對比「預期最新交易日」
    # 若 cache 已有預期最新交易日的資料 → 跳過 FinMind，省 quota
    # 若 cache 落後（例如還停在週五但今天週一已收盤）→ 重抓
    # 但若 cache 落後 ＆ 1 小時內試過（updated 在 1 小時內）→ 仍跳過避免浪費 quota
    #   （這 case 通常是 FinMind 還沒 publish 今日資料，下次 cron 再試）
    # 用 --force 旗標可繞過（週六完整 pipeline 強制重抓時用）
    if "--force" not in sys.argv and by_stock:
        from datetime import datetime as _dt, timedelta as _td
        # 預期最新交易日（強制 TW 時區，14:00 為切換點，週末回到上週五）
        _now_tw = _dt.utcnow() + _td(hours=8)
        _wd = _now_tw.weekday()
        if _wd >= 5:
            _expected = (_now_tw - _td(days=_wd - 4)).date()
        elif _now_tw.hour >= 14:
            _expected = _now_tw.date()
        elif _wd == 0:
            _expected = (_now_tw - _td(days=3)).date()
        else:
            _expected = (_now_tw - _td(days=1)).date()
        expected_str = _expected.strftime("%Y-%m-%d")

        # 看 cache 中「達到 expected_str」的股票占比（不能用 max，因為只要 1 支
        # 抓到就會誤判全體 OK；實際很可能是部分 402 中斷導致只有少數抓到）
        total = len(by_stock)
        at_expected = sum(
            1 for h in by_stock.values()
            if h and h[-1].get("date", "") >= expected_str
        )
        coverage = at_expected / total if total else 0
        # cache 中所有股票最新一筆 date 的最大值（log 用）
        latest_in_cache = max(
            (h[-1].get("date", "") for h in by_stock.values() if h),
            default=""
        )

        # 90% 以上股票都到了 expected_date → 安全，跳過
        if coverage >= 0.9:
            logger.info("institutional cache 涵蓋率 %.0f%%（%d/%d 支已到 %s）→ 跳過 FinMind，"
                        "直接用 cache 重算 buy streak",
                        coverage * 100, at_expected, total, expected_str)
            enrich_stocks_json(by_stock)
            return 0

        # cache 落後但 1 小時內已試過 → 假設 FinMind 還沒 publish，避免浪費 quota
        # 統一用 TW 時區比（updated 也是 TW 時區寫的）
        last_updated = db.get("updated") or ""
        try:
            last_dt = _dt.fromisoformat(last_updated)
            age_min = (_now_tw - last_dt).total_seconds() / 60
        except Exception:
            age_min = 9999
        if 0 <= age_min < 60:
            logger.info("institutional cache 落後（最新 %s < 預期 %s）但 %.0f 分鐘前已試過，"
                        "可能 FinMind 還沒發，跳過省 quota", latest_in_cache, expected_str, age_min)
            enrich_stocks_json(by_stock)
            return 0

        logger.info("institutional cache 落後（最新 %s < 預期 %s）→ 重抓",
                    latest_in_cache, expected_str)

    # ============================================================
    # PRIMARY: TWSE/TPEx batch（無額度限制，1-2 個 API call 拿全部）
    # 只抓 expected_str 那一天的資料，merge 進 cache
    # 涵蓋率夠 → 跳過 FinMind；不夠 → 用 FinMind 補
    # ============================================================
    from datetime import datetime as _dt_run, timedelta as _td_run
    _now_tw_run = _dt_run.utcnow() + _td_run(hours=8)
    _wd_run = _now_tw_run.weekday()
    if _wd_run >= 5:
        _expected_run = (_now_tw_run - _td_run(days=_wd_run - 4)).date()
    elif _now_tw_run.hour >= 14:
        _expected_run = _now_tw_run.date()
    elif _wd_run == 0:
        _expected_run = (_now_tw_run - _td_run(days=3)).date()
    else:
        _expected_run = (_now_tw_run - _td_run(days=1)).date()
    expected_for_official = _expected_run.strftime("%Y-%m-%d")

    logger.info("先嘗試 TWSE/TPEx batch fallback (date=%s)…", expected_for_official)
    official_data = fetch_official_for_date(expected_for_official)
    if official_data:
        touched = merge_day_into_cache(by_stock, expected_for_official, official_data)
        logger.info("TWSE/TPEx 補上 %s → 合併 %d 支（cache 現共 %d 支）",
                    expected_for_official, touched, len(by_stock))

        # 重算涵蓋率，夠就直接收工
        total_after = len(by_stock)
        at_expected_after = sum(
            1 for h in by_stock.values()
            if h and h[-1].get("date", "") >= expected_for_official
        )
        if total_after > 0 and at_expected_after / total_after >= 0.9:
            logger.info("Official APIs 補完涵蓋率 %.0f%%（%d/%d）→ 跳過 FinMind",
                        at_expected_after / total_after * 100,
                        at_expected_after, total_after)
            _now_tw_str = (_dt_run.utcnow() + _td_run(hours=8)).strftime("%Y-%m-%dT%H:%M:%S")
            db["updated"]  = _now_tw_str
            db["by_stock"] = by_stock
            OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
            with open(OUT_PATH, "w", encoding="utf-8") as f:
                json.dump(db, f, ensure_ascii=False, separators=(",", ":"))
            logger.info("寫入 %s", OUT_PATH)
            enrich_stocks_json(by_stock)
            return 0
        else:
            logger.info("Official APIs 涵蓋率不足（%d/%d），續用 FinMind 補",
                        at_expected_after, total_after)

    logger.info("共 %d 支股票要抓三大法人 (FinMind fallback)", len(stock_ids))

    # 起始日：今天往前 LOOKBACK_DAYS 天
    from datetime import datetime, timedelta
    start_date = (datetime.now() - timedelta(days=LOOKBACK_DAYS)).strftime("%Y-%m-%d")

    fetched = 0
    skipped = 0
    quota_hit = False
    for i, sid in enumerate(stock_ids, 1):
        records = fetch_finmind(sid, start_date)
        if records is None:
            quota_hit = True   # FinMind 額度可能用完，後面就用 cache
            break
        if not records:
            skipped += 1
        else:
            new_data = normalize_records(records)
            # merge（同日覆蓋，保留歷史 KEEP_DAYS 天）
            existing_history = by_stock.get(sid) or []
            existing_dates = {h["date"] for h in existing_history}
            for date, vals in new_data.items():
                if date in existing_dates:
                    # 覆蓋
                    for h in existing_history:
                        if h["date"] == date:
                            h.update(vals)
                            break
                else:
                    existing_history.append({"date": date, **vals})
            existing_history.sort(key=lambda x: x.get("date", ""))
            existing_history = existing_history[-KEEP_DAYS:]
            by_stock[sid] = existing_history
            fetched += 1

        time.sleep(0.15)  # 節流，避免被 ban
        if i % 30 == 0:
            logger.info("進度 %d/%d（成功 %d / 跳過 %d）", i, len(stock_ids), fetched, skipped)

    # 統一用 TW 時區寫 timestamp（不管在 Windows local 還是 Linux runner 都一致）
    from datetime import datetime as _dt2, timedelta as _td2
    _now_tw_str = (_dt2.utcnow() + _td2(hours=8)).strftime("%Y-%m-%dT%H:%M:%S")
    db["updated"]  = _now_tw_str
    db["by_stock"] = by_stock

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, separators=(",", ":"))

    logger.info("寫入 %s", OUT_PATH)
    logger.info("  成功 %d 支 / 跳過 %d / %s",
                fetched, skipped,
                "額度用完，部分用快取" if quota_hit else "全部完成")

    # 算每支股票的「連續買超天數」並寫進 stocks.json（給前端 filter 用）
    enrich_stocks_json(by_stock)
    return 0


def _consecutive_buy_streak(history: list[dict], key: str) -> int:
    """從最新一筆往回，連續買超（key > 0）天數。
    history 已依 date 升序排好，最新在 [-1]。"""
    streak = 0
    for rec in reversed(history):
        if (rec.get(key) or 0) > 0:
            streak += 1
        else:
            break
    return streak


def enrich_stocks_json(by_stock: dict[str, list[dict]]):
    """讀 stocks.json，每支股票算外資/投信連續買超天數，寫回。"""
    stocks_path = DATA_DIR / "stocks.json"
    if not stocks_path.exists():
        logger.warning("stocks.json 不存在，跳過 streak 寫入")
        return
    try:
        stocks = json.loads(stocks_path.read_text(encoding="utf-8"))
    except Exception as e:
        logger.warning("讀 stocks.json 失敗：%s", e)
        return

    updated = 0
    for s in stocks:
        history = by_stock.get(s["id"]) or []
        s["foreignBuyStreak"] = _consecutive_buy_streak(history, "foreign")
        s["trustBuyStreak"]   = _consecutive_buy_streak(history, "trust")
        updated += 1

    with open(stocks_path, "w", encoding="utf-8") as f:
        json.dump(stocks, f, ensure_ascii=False, indent=2)
    logger.info("stocks.json 寫入 buy streak：%d 支", updated)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    sys.exit(run())
