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
import re
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
#  Yahoo TW finance fallback（FinMind 撞 402 後的備援）
#  資料源：tw.stock.yahoo.com/quote/{id}.{TW|TWO}/institutional-trading
#  特點：每次回傳 100 天歷史（比 FinMind 30 天多）；無 quota 但需控制頻率
# ============================================================

YAHOO_INST_URL = "https://tw.stock.yahoo.com/quote/{stock_id}.{suffix}/institutional-trading"
# 動態快取 stock_id → suffix（'TW' 或 'TWO'），避免每次都試錯
_yahoo_suffix_cache: dict = {}


def _fetch_yahoo_one(stock_id: str, suffix: str) -> list | None:
    """單次嘗試指定 suffix 的 Yahoo 頁面，回傳 trades list 或 None。"""
    url = YAHOO_INST_URL.format(stock_id=stock_id, suffix=suffix)
    try:
        r = requests.get(url, timeout=30, headers={"User-Agent": USER_AGENT})
        if r.status_code != 200:
            return None
        html = r.text
    except Exception as e:
        logger.debug("Yahoo [%s.%s] HTTP 例外: %s", stock_id, suffix, e)
        return None

    # 找 institutionBuySell-100-day-{stock_id}.{suffix} 的 trades array
    # JSON: "key":{"data":{"trades":[...],"refreshedTs":"..."},...}
    key = f"institutionBuySell-100-day-{stock_id}.{suffix}"
    pattern = re.compile(
        r'"' + re.escape(key) + r'":\{"data":\{"trades":(\[.*?\]),"refreshedTs"',
        re.DOTALL
    )
    m = pattern.search(html)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except Exception as e:
        logger.debug("Yahoo [%s.%s] JSON parse 失敗: %s", stock_id, suffix, e)
        return None


def fetch_yahoo_institutional(stock_id: str) -> list[dict] | None:
    """從 Yahoo TW 抓單支股票 100 天三大法人歷史。
    自動偵測 .TW (上市) / .TWO (上櫃) suffix，cache 後續使用。
    回傳 list of {date, foreign, trust, dealer}（單位：張），最舊→最新排序。
    None = 兩個 suffix 都 fail。"""
    cached = _yahoo_suffix_cache.get(stock_id)
    suffixes_to_try = []
    if cached:
        suffixes_to_try.append(cached)
    for s in ("TW", "TWO"):
        if s != cached:
            suffixes_to_try.append(s)

    trades = None
    used_suffix = None
    for suffix in suffixes_to_try:
        trades = _fetch_yahoo_one(stock_id, suffix)
        if trades:
            used_suffix = suffix
            break

    if not trades:
        return None

    _yahoo_suffix_cache[stock_id] = used_suffix

    result = []
    for t in trades:
        date = (t.get("date") or "")[:10]
        if not date:
            continue
        try:
            foreign = int(t.get("foreignDiffVolK") or 0)
            trust   = int(t.get("investmentTrustDiffVolK") or 0)
            dealer  = int(t.get("dealerDiffVolK") or 0)
        except (ValueError, TypeError):
            continue
        result.append({
            "date":    date,
            "foreign": foreign,
            "trust":   trust,
            "dealer":  dealer,
        })
    # Yahoo 已是時間序，但保險起見再 sort 一次
    result.sort(key=lambda x: x["date"])
    return result


def _merge_yahoo_records(by_stock: dict, sid: str, yahoo_records: list[dict]):
    """把 Yahoo 抓到的 trades merge 進 by_stock 歷史。"""
    existing_history = by_stock.get(sid) or []
    existing_dates = {h["date"] for h in existing_history}
    for rec in yahoo_records:
        date = rec["date"]
        vals = {k: rec[k] for k in ("foreign", "trust", "dealer")}
        if date in existing_dates:
            for h in existing_history:
                if h["date"] == date:
                    h.update(vals)
                    break
        else:
            existing_history.append({"date": date, **vals})
            existing_dates.add(date)
    existing_history.sort(key=lambda x: x.get("date", ""))
    existing_history = existing_history[-KEEP_DAYS:]
    by_stock[sid] = existing_history


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

    logger.info("共 %d 支股票要抓三大法人", len(stock_ids))

    # 起始日：今天往前 LOOKBACK_DAYS 天
    from datetime import datetime, timedelta
    start_date = (datetime.now() - timedelta(days=LOOKBACK_DAYS)).strftime("%Y-%m-%d")

    fetched = 0
    skipped = 0
    quota_hit = False           # FinMind 是否已撞 402
    yahoo_fetched = 0           # 用 Yahoo 補抓的支數（log 用）
    for i, sid in enumerate(stock_ids, 1):
        # ─── PRIMARY: FinMind ───
        if not quota_hit:
            records = fetch_finmind(sid, start_date)
            if records is None:
                quota_hit = True
                logger.warning("FinMind 402 額度用完（at %d/%d, %s）→ 切到 Yahoo fallback",
                               i, len(stock_ids), sid)
                # 不 break，這支也試 Yahoo
            elif not records:
                skipped += 1
                time.sleep(0.5)
                continue
            else:
                new_data = normalize_records(records)
                existing_history = by_stock.get(sid) or []
                existing_dates = {h["date"] for h in existing_history}
                for date, vals in new_data.items():
                    if date in existing_dates:
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
                time.sleep(0.5)   # 從 0.15 調高，避免 FinMind soft throttle
                if i % 30 == 0:
                    logger.info("進度 %d/%d（FinMind 成功 %d / 跳過 %d）",
                                i, len(stock_ids), fetched, skipped)
                continue

        # ─── FALLBACK: Yahoo ───（FinMind 402 後執行）
        yahoo_records = fetch_yahoo_institutional(sid)
        if yahoo_records:
            _merge_yahoo_records(by_stock, sid, yahoo_records)
            fetched += 1
            yahoo_fetched += 1
        else:
            skipped += 1
        time.sleep(0.5)
        if i % 30 == 0:
            logger.info("進度 %d/%d（Yahoo 補了 %d 支 / 累計成功 %d / 跳過 %d）",
                        i, len(stock_ids), yahoo_fetched, fetched, skipped)

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
