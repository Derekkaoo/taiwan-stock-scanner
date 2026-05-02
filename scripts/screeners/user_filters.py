"""
user_filters.py — Python port of frontend/src/utils/filters.ts

把前端的 applyFilters 邏輯翻成 Python，給 push_user_strategies.py 用。
**邏輯必須跟 filters.ts 完全一致**，否則使用者 Telegram 收到的命中清單會跟網頁看到的不一樣。

Schema 沿用前端 Filters interface（從 D1 strategies.filters_json 解出來的 dict）：

    {
      "volume":     [lo, hi],
      "marketCap":  [lo, hi],
      "delta":      [lo, hi],
      "revenueYoY": [lo, hi],
      "industries": [...],
      "growth":     {"quarters": 0|1|2|4|8, "metrics": {"eps": bool, "grossMargin": bool, "operatingMargin": bool}},
      "absValue":   {"quarter": "", "grossMargin": [lo, hi], "operatingMargin": [lo, hi], "eps": [lo, hi]},
      "institutional": {"days": 0|1|3|5|20, "foreign": bool, "trust": bool},
      "market":     "all" | "listed" | "otc"
    }
"""
from __future__ import annotations

from typing import Iterable, List, Dict, Any, Tuple, Optional

EPS = 1e-6

# 對應 frontend types/index.ts 的 FILTER_BOUNDS
FILTER_BOUNDS = {
    "volume":          {"min": 0,    "max": 500000},
    "marketCap":       {"min": 0,    "max": 5000},
    "delta":           {"min": 0.1,  "max": 5},
    "revenueYoY":      {"min": -50,  "max": 200},
    "grossMargin":     {"min": -50,  "max": 100},
    "operatingMargin": {"min": -100, "max": 100},
    "eps":             {"min": -10,  "max": 100},
    "nDayReturn":      {"min": -10,  "max": 50},
}


def _b(key: str) -> Tuple[float, float]:
    b = FILTER_BOUNDS[key]
    return (b["min"], b["max"])


# 對應 frontend types/index.ts 的 DEFAULT_FILTERS
DEFAULT_FILTERS: Dict[str, Any] = {
    "volume":     list(_b("volume")),
    "marketCap":  list(_b("marketCap")),
    "delta":      list(_b("delta")),
    "revenueYoY": list(_b("revenueYoY")),
    "industries": [],
    "growth": {
        "quarters": 0,
        "metrics": {"eps": False, "grossMargin": False, "operatingMargin": False},
    },
    "absValue": {
        "quarter": "",
        "grossMargin":     list(_b("grossMargin")),
        "operatingMargin": list(_b("operatingMargin")),
        "eps":             list(_b("eps")),
    },
    "institutional": {"days": 0, "foreign": False, "trust": False},
    "market": "all",
    "nDayReturn": {
        "days": 0,
        "range": list(_b("nDayReturn")),
    },
    "nDayHigh": {"days": 0},
}


def _range_active(value: List[float], default: List[float]) -> bool:
    return abs(value[0] - default[0]) > EPS or abs(value[1] - default[1]) > EPS


def _in_range(v: float, lo_hi: List[float]) -> bool:
    lo, hi = lo_hi
    return (v >= lo - EPS) and (v <= hi + EPS)


def _last_n_yoy(arr: Optional[List[Dict[str, Any]]], n: int) -> Optional[List[float]]:
    if not arr or len(arr) < n:
        return None
    return [float(x.get("yoy", 0)) for x in arr[-n:]]


def _pass_growth(s: Dict[str, Any], g: Dict[str, Any]) -> bool:
    if g.get("quarters", 0) == 0:
        return True
    f = s.get("fundamentals")
    if not f:
        return False
    metrics = g.get("metrics", {}) or {}
    checks: List[Optional[List[Dict[str, Any]]]] = []
    if metrics.get("eps"):
        checks.append(f.get("epsYoY"))
    if metrics.get("grossMargin"):
        checks.append(f.get("grossMarginYoY"))
    if metrics.get("operatingMargin"):
        checks.append(f.get("operatingMarginYoY"))
    if not checks:
        return True
    n = g["quarters"]
    for arr in checks:
        last = _last_n_yoy(arr, n)
        if last is None:
            return False
        if not all(v > 0 for v in last):
            return False
    return True


def _find_quarter_value(arr: Optional[List[Dict[str, Any]]], quarter: str) -> Optional[float]:
    if not arr or not quarter:
        return None
    for x in arr:
        if x.get("quarter") == quarter:
            v = x.get("value")
            return float(v) if v is not None else None
    return None


def _pass_market(s: Dict[str, Any], m: str) -> bool:
    if m == "all":
        return True
    market = s.get("market")
    # 沒抓到 market 欄位 → 不確定，slider 動過就排除（同前端邏輯）
    if not market:
        return False
    if m == "listed":
        return market == "上市"
    if m == "otc":
        return market == "上櫃"
    return True


def _pass_institutional(s: Dict[str, Any], f: Dict[str, Any]) -> bool:
    days = f.get("days", 0)
    if days == 0:
        return True
    foreign = bool(f.get("foreign"))
    trust = bool(f.get("trust"))
    if not foreign and not trust:
        return True
    if foreign:
        if (s.get("foreignBuyStreak") or 0) < days:
            return False
    if trust:
        if (s.get("trustBuyStreak") or 0) < days:
            return False
    return True


def _pass_abs_value(s: Dict[str, Any], a: Dict[str, Any]) -> bool:
    if not a.get("quarter"):
        return True
    f = s.get("fundamentals")
    if not f:
        return False

    gm_active = _range_active(a["grossMargin"],     DEFAULT_FILTERS["absValue"]["grossMargin"])
    om_active = _range_active(a["operatingMargin"], DEFAULT_FILTERS["absValue"]["operatingMargin"])
    ep_active = _range_active(a["eps"],             DEFAULT_FILTERS["absValue"]["eps"])

    if not gm_active and not om_active and not ep_active:
        return True

    q = a["quarter"]
    if gm_active:
        v = _find_quarter_value(f.get("grossMargin"), q)
        if v is None or not _in_range(v, a["grossMargin"]):
            return False
    if om_active:
        v = _find_quarter_value(f.get("operatingMargin"), q)
        if v is None or not _in_range(v, a["operatingMargin"]):
            return False
    if ep_active:
        v = _find_quarter_value(f.get("eps"), q)
        if v is None or not _in_range(v, a["eps"]):
            return False
    return True


def _calc_n_day_return(bars: Optional[List[Dict[str, Any]]], n: int) -> Optional[float]:
    """最近 N 日漲跌幅 %（最新 close vs N 根前 close）。資料不足回 None。"""
    if not bars or len(bars) < n + 1:
        return None
    try:
        last = bars[-1].get("c")
        prev = bars[-1 - n].get("c")
    except Exception:
        return None
    if not last or not prev:
        return None
    return ((last - prev) / prev) * 100.0


def _pass_n_day_return(s: Dict[str, Any], f: Dict[str, Any], klines: Dict[str, List[Dict[str, Any]]]) -> bool:
    days = f.get("days", 0)
    if days == 0:
        return True
    bars = klines.get(str(s.get("id", ""))) if klines else None
    r = _calc_n_day_return(bars, days)
    if r is None:
        return False
    rng = f.get("range") or DEFAULT_FILTERS["nDayReturn"]["range"]
    if not _range_active(rng, DEFAULT_FILTERS["nDayReturn"]["range"]):
        return True
    return _in_range(r, rng)


def _pass_n_day_high(s: Dict[str, Any], f: Dict[str, Any], klines: Dict[str, List[Dict[str, Any]]]) -> bool:
    days = f.get("days", 0)
    if days == 0:
        return True
    bars = klines.get(str(s.get("id", ""))) if klines else None
    if not bars or len(bars) < days:
        return False
    last = bars[-1]
    last_h = last.get("h")
    if not last_h:
        return False
    window = bars[-days:]
    max_h = max((b.get("h") or float("-inf")) for b in window)
    return last_h >= max_h - 1e-6


def apply_filters(
    stocks: Iterable[Dict[str, Any]],
    f: Dict[str, Any],
    klines: Optional[Dict[str, List[Dict[str, Any]]]] = None,
) -> List[Dict[str, Any]]:
    """跟 frontend filters.ts 的 applyFilters 邏輯對等。

    Args:
        stocks: stock dict 列表（直接從 stocks.json 讀進來的格式）
        f: filter dict（從 D1 strategies.filters_json 解出來，schema 同前端 Filters）
        klines: stock_id → bars list（給 nDayReturn / nDayHigh 用，沒給就視為空）
    Returns:
        match 的 stock list（順序維持輸入順序）
    """
    klines = klines or {}
    # 補齊缺欄位（舊 strategy 在 schema 升級後可能缺欄位，跟前端 applyServerFilters 同邏輯）
    f = _merge_with_defaults(f)

    vol_active  = _range_active(f["volume"],     DEFAULT_FILTERS["volume"])
    mc_active   = _range_active(f["marketCap"],  DEFAULT_FILTERS["marketCap"])
    d_active    = _range_active(f["delta"],      DEFAULT_FILTERS["delta"])
    r_active    = _range_active(f["revenueYoY"], DEFAULT_FILTERS["revenueYoY"])
    ind_active  = len(f["industries"]) > 0
    ind_set     = set(f["industries"])

    g = f["growth"]
    grow_active = g["quarters"] != 0 and (
        g["metrics"]["eps"] or g["metrics"]["grossMargin"] or g["metrics"]["operatingMargin"]
    )

    a = f["absValue"]
    abs_active = bool(a.get("quarter")) and (
        _range_active(a["grossMargin"],     DEFAULT_FILTERS["absValue"]["grossMargin"]) or
        _range_active(a["operatingMargin"], DEFAULT_FILTERS["absValue"]["operatingMargin"]) or
        _range_active(a["eps"],             DEFAULT_FILTERS["absValue"]["eps"])
    )

    inst = f["institutional"]
    inst_active = inst["days"] != 0 and (inst["foreign"] or inst["trust"])

    market_active = f["market"] != "all"

    n_ret = f["nDayReturn"]
    n_ret_active = n_ret.get("days", 0) != 0
    n_high = f["nDayHigh"]
    n_high_active = n_high.get("days", 0) != 0

    # 沒有任何 filter 啟用 → 全傳回（這跟前端一致：等同沒篩）
    if not (vol_active or mc_active or d_active or r_active or ind_active or
            grow_active or abs_active or inst_active or market_active or
            n_ret_active or n_high_active):
        return list(stocks)

    out: List[Dict[str, Any]] = []
    for s in stocks:
        if vol_active:
            v = (s.get("volumes") or {}).get("d1")
            if v is None or not _in_range(v, f["volume"]):
                continue
        if mc_active and not _in_range(s.get("marketCap", 0), f["marketCap"]):
            continue
        if d_active and not _in_range(s.get("delta", 0), f["delta"]):
            continue
        if r_active:
            ry = s.get("revenueYoY")
            if ry is None or not _in_range(ry, f["revenueYoY"]):
                continue
        if ind_active:
            gs = s.get("groups") or []
            if not gs:
                gs = [s.get("group", "")] if s.get("group") else []
            if not any(g_ in ind_set for g_ in gs):
                continue
        if grow_active and not _pass_growth(s, g):
            continue
        if abs_active and not _pass_abs_value(s, a):
            continue
        if inst_active and not _pass_institutional(s, inst):
            continue
        if market_active and not _pass_market(s, f["market"]):
            continue
        if n_ret_active and not _pass_n_day_return(s, n_ret, klines):
            continue
        if n_high_active and not _pass_n_day_high(s, n_high, klines):
            continue
        out.append(s)
    return out


def _merge_with_defaults(f: Dict[str, Any]) -> Dict[str, Any]:
    """跟 frontend StrategyManager.applyServerFilters 同邏輯：
    保證 schema 完整（避免舊 strategy 缺新欄位導致 KeyError）。
    """
    if not isinstance(f, dict):
        f = {}
    out = {**DEFAULT_FILTERS, **f}
    # deep-merge 巢狀物件
    out["growth"] = {
        **DEFAULT_FILTERS["growth"],
        **(f.get("growth") or {}),
    }
    out["growth"]["metrics"] = {
        **DEFAULT_FILTERS["growth"]["metrics"],
        **((f.get("growth") or {}).get("metrics") or {}),
    }
    out["absValue"] = {
        **DEFAULT_FILTERS["absValue"],
        **(f.get("absValue") or {}),
    }
    out["institutional"] = {
        **DEFAULT_FILTERS["institutional"],
        **(f.get("institutional") or {}),
    }
    out["nDayReturn"] = {
        **DEFAULT_FILTERS["nDayReturn"],
        **(f.get("nDayReturn") or {}),
    }
    out["nDayHigh"] = {
        **DEFAULT_FILTERS["nDayHigh"],
        **(f.get("nDayHigh") or {}),
    }
    return out


__all__ = ["apply_filters", "DEFAULT_FILTERS", "FILTER_BOUNDS"]
