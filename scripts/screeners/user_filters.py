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
    "nDayHigh":      {"days": 0},
    "volumeNewHigh": {"days": 0},
    "volumeSurge":   {"baseline": "ma5", "multiplier": 0},
    "maAlignment":    {"periods": []},
    "maDirection":    {"periods": []},
    "maBreakout":     {"days": 0, "period": 0},
    "maContinuation": {"direction": "off", "period": 0},
    "maSustained":    {"days": 0, "period": 0},
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


def _pass_volume_new_high(s: Dict[str, Any], f: Dict[str, Any], klines: Dict[str, List[Dict[str, Any]]]) -> bool:
    days = f.get("days", 0)
    if days == 0:
        return True
    bars = klines.get(str(s.get("id", ""))) if klines else None
    if not bars or len(bars) < days:
        return False
    last_v = bars[-1].get("v")
    if not last_v:
        return False
    window = bars[-days:]
    max_v = max((b.get("v") or float("-inf")) for b in window)
    return last_v >= max_v - 1e-6


def _calc_last_ma(bars: List[Dict[str, Any]], period: int) -> Optional[float]:
    """算最後一根 bar 的 N 日 MA（簡單均線）。資料不足或缺值 → None。"""
    if not bars or len(bars) < period:
        return None
    total = 0.0
    for b in bars[-period:]:
        c = b.get("c")
        if not c:
            return None
        total += c
    return total / period


def _pass_ma_alignment(s: Dict[str, Any], f: Dict[str, Any], klines: Dict[str, List[Dict[str, Any]]]) -> bool:
    periods = f.get("periods") or []
    if len(periods) < 2:
        return True
    bars = klines.get(str(s.get("id", ""))) if klines else None
    if not bars:
        return False
    sorted_periods = sorted(periods)
    prev_value = float("inf")
    for p in sorted_periods:
        v = _calc_last_ma(bars, p)
        if v is None:
            return False
        if v >= prev_value:
            return False
        prev_value = v
    return True


def _pass_ma_direction(s: Dict[str, Any], f: Dict[str, Any], klines: Dict[str, List[Dict[str, Any]]]) -> bool:
    periods = f.get("periods") or []
    if len(periods) == 0:
        return True
    bars = klines.get(str(s.get("id", ""))) if klines else None
    if not bars or len(bars) < 2:
        return False
    for p in periods:
        today_ma = _calc_last_ma(bars, p)
        yest_ma  = _calc_last_ma(bars[:-1], p)
        if today_ma is None or yest_ma is None:
            return False
        if today_ma <= yest_ma:
            return False
    return True


def _pass_ma_breakout(s: Dict[str, Any], f: Dict[str, Any], klines: Dict[str, List[Dict[str, Any]]]) -> bool:
    """N 日內任一根 K 棒出現 close 由下往上突破 MA。
    突破事件：bar[i].c > MA(i) AND bar[i-1].c <= MA(i-1)
    搜尋窗口：最後 days 根 K 棒（含今天）。
    """
    days = f.get("days", 0) or 0
    period = f.get("period", 0) or 0
    if days == 0 or period == 0:
        return True
    bars = klines.get(str(s.get("id", ""))) if klines else None
    if not bars or len(bars) < period + 1:
        return False

    # 算每一根 bar[i] 的 MA(i)（含 bar[i] 自己）
    ma: List[Optional[float]] = [None] * len(bars)
    total = 0.0
    for i in range(len(bars)):
        c = bars[i].get("c") if bars[i] else None
        if not c:
            total = 0.0
            continue
        total += c
        if i >= period:
            old = bars[i - period].get("c") if bars[i - period] else None
            if old:
                total -= old
        if i >= period - 1:
            ma[i] = total / period

    # 在最後 days 根（含今天）找突破事件
    start_idx = max(period, len(bars) - days)
    for i in range(start_idx, len(bars)):
        c_today = bars[i].get("c") if bars[i] else None
        c_yest  = bars[i - 1].get("c") if bars[i - 1] else None
        ma_today = ma[i]
        ma_yest  = ma[i - 1]
        if not c_today or not c_yest or ma_today is None or ma_yest is None:
            continue
        if c_today > ma_today and c_yest <= ma_yest:
            return True
    return False


def _pass_ma_continuation(s: Dict[str, Any], f: Dict[str, Any], klines: Dict[str, List[Dict[str, Any]]]) -> bool:
    """明日 MA 續揚 / 下彎（扣抵值預測）：
    扣抵值 = 明日將從 MA 計算窗口扣掉的那根 close = bars[len - period].c
    - up:   今日 close > 扣抵值（即使明日盤平，MA 也會上揚）
    - down: 今日 close < 扣抵值（即使明日盤平，MA 也會下彎）
    """
    direction = f.get("direction", "off")
    period = f.get("period", 0) or 0
    if direction == "off" or period == 0:
        return True
    bars = klines.get(str(s.get("id", ""))) if klines else None
    if not bars or len(bars) < period:
        return False
    last_close = bars[-1].get("c") if bars[-1] else None
    dropout_close = bars[-period].get("c") if bars[-period] else None  # N 天前 close
    if not last_close or not dropout_close:
        return False
    if direction == "up":
        return last_close > dropout_close
    if direction == "down":
        return last_close < dropout_close
    return True


def _pass_ma_sustained(s: Dict[str, Any], f: Dict[str, Any], klines: Dict[str, List[Dict[str, Any]]]) -> bool:
    """未來 N 日 MA 不下彎（扣抵保護）：
    未來第 d 日（d=1..N）的扣抵值 = bars[len - period + d - 1].c
    條件：每個 d 的扣抵值都 < 今日 close
    → 即使股價盤整不漲，MA 仍會連續上揚 N 天。
    """
    days = f.get("days", 0) or 0
    period = f.get("period", 0) or 0
    if days == 0 or period == 0:
        return True
    bars = klines.get(str(s.get("id", ""))) if klines else None
    if not bars or len(bars) < period:
        return False
    last_close = bars[-1].get("c") if bars[-1] else None
    if not last_close:
        return False
    for d in range(1, days + 1):
        idx = len(bars) - period + d - 1
        dropout = bars[idx].get("c") if bars[idx] else None
        if not dropout:
            return False
        if last_close <= dropout:
            return False
    return True


def _pass_volume_surge(s: Dict[str, Any], f: Dict[str, Any], klines: Dict[str, List[Dict[str, Any]]]) -> bool:
    mult = f.get("multiplier", 0)
    if mult == 0:
        return True
    bars = klines.get(str(s.get("id", ""))) if klines else None
    if not bars or len(bars) < 2:
        return False
    last_v = bars[-1].get("v")
    if not last_v:
        return False

    baseline_kind = f.get("baseline", "ma5")
    if baseline_kind == "prev":
        baseline = bars[-2].get("v")
    else:
        n = 5 if baseline_kind == "ma5" else 10 if baseline_kind == "ma10" else 60
        if len(bars) < n + 1:
            return False
        window = bars[-n - 1:-1]  # 不含最新一根
        vols = [b.get("v") for b in window if b.get("v") and b.get("v") > 0]
        if not vols:
            return False
        baseline = sum(vols) / len(vols)

    if not baseline or baseline <= 0:
        return False
    return last_v >= baseline * mult


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

    v_new_high = f["volumeNewHigh"]
    v_new_high_active = v_new_high.get("days", 0) != 0
    v_surge = f["volumeSurge"]
    v_surge_active = v_surge.get("multiplier", 0) != 0

    ma_align = f["maAlignment"]
    ma_align_active = len(ma_align.get("periods") or []) >= 2

    ma_dir = f["maDirection"]
    ma_dir_active = len(ma_dir.get("periods") or []) >= 1

    ma_break = f["maBreakout"]
    ma_break_active = (ma_break.get("days", 0) or 0) != 0 and (ma_break.get("period", 0) or 0) != 0

    ma_cont = f["maContinuation"]
    ma_cont_active = (ma_cont.get("direction", "off") or "off") != "off" and (ma_cont.get("period", 0) or 0) != 0

    ma_sust = f["maSustained"]
    ma_sust_active = (ma_sust.get("days", 0) or 0) != 0 and (ma_sust.get("period", 0) or 0) != 0

    # 沒有任何 filter 啟用 → 全傳回（這跟前端一致：等同沒篩）
    if not (vol_active or mc_active or d_active or r_active or ind_active or
            grow_active or abs_active or inst_active or market_active or
            n_ret_active or n_high_active or v_new_high_active or v_surge_active or
            ma_align_active or ma_dir_active or ma_break_active or
            ma_cont_active or ma_sust_active):
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
        if v_new_high_active and not _pass_volume_new_high(s, v_new_high, klines):
            continue
        if v_surge_active and not _pass_volume_surge(s, v_surge, klines):
            continue
        if ma_align_active and not _pass_ma_alignment(s, ma_align, klines):
            continue
        if ma_dir_active and not _pass_ma_direction(s, ma_dir, klines):
            continue
        if ma_break_active and not _pass_ma_breakout(s, ma_break, klines):
            continue
        if ma_cont_active and not _pass_ma_continuation(s, ma_cont, klines):
            continue
        if ma_sust_active and not _pass_ma_sustained(s, ma_sust, klines):
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
    out["volumeNewHigh"] = {
        **DEFAULT_FILTERS["volumeNewHigh"],
        **(f.get("volumeNewHigh") or {}),
    }
    out["volumeSurge"] = {
        **DEFAULT_FILTERS["volumeSurge"],
        **(f.get("volumeSurge") or {}),
    }
    out["maAlignment"] = {
        **DEFAULT_FILTERS["maAlignment"],
        **(f.get("maAlignment") or {}),
    }
    out["maDirection"] = {
        **DEFAULT_FILTERS["maDirection"],
        **(f.get("maDirection") or {}),
    }
    out["maBreakout"] = {
        **DEFAULT_FILTERS["maBreakout"],
        **(f.get("maBreakout") or {}),
    }
    out["maContinuation"] = {
        **DEFAULT_FILTERS["maContinuation"],
        **(f.get("maContinuation") or {}),
    }
    out["maSustained"] = {
        **DEFAULT_FILTERS["maSustained"],
        **(f.get("maSustained") or {}),
    }
    return out


__all__ = ["apply_filters", "DEFAULT_FILTERS", "FILTER_BOUNDS"]
