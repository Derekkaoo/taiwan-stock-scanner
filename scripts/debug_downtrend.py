"""Diagnostic for downtrend break filter (v4: XQ kk + N-day high breakout)."""
import json
from pathlib import Path

SHORT_SLOPE_BARS = 5
MIN_DAILY_RETURN = 0.02


def pivots_to_high_n(pivots):
    if pivots <= 3: return 5
    if pivots == 4: return 10
    return 15


def linreg_slope(values):
    n = len(values)
    if n < 2: return None
    sx = sy = sxy = sx2 = 0.0
    for i in range(n):
        sx += i; sy += values[i]
        sxy += i * values[i]; sx2 += i * i
    denom = n * sx2 - sx * sx
    if denom == 0: return None
    return (n * sxy - sx * sy) / denom


def diagnose(bars, days, pivots, sid="", name=""):
    Length = min(days, 60)
    HighN = pivots_to_high_n(pivots)
    required = max(Length, HighN) + 2
    if not bars or len(bars) < required:
        return ("0_no_bars", {"have": len(bars) if bars else 0, "need": required})

    # kk
    kk = [0.0] * len(bars)
    for i in range(1, len(bars)):
        prev_c = bars[i-1].get("c"); cur_c = bars[i].get("c")
        v = bars[i].get("v") or 0
        if not prev_c or not cur_c:
            kk[i] = kk[i-1]; continue
        kk[i] = kk[i-1] + (cur_c - prev_c) / prev_c * v

    value1 = linreg_slope(kk[-Length:])
    value2 = linreg_slope(kk[-SHORT_SLOPE_BARS:])
    if value1 is None or value2 is None:
        return ("1_slope_fail", None)

    if not (value1 < 0 and value2 > 0):
        return ("2_not_long_down_short_up",
                {"value1": round(value1, 2), "value2": round(value2, 2)})

    today_idx = len(bars) - 1
    today_close = bars[today_idx].get("c")
    if not today_close:
        return ("3_no_close", None)
    HH = float("-inf")
    for i in range(today_idx - HighN, today_idx):
        if i < 0: continue
        h = bars[i].get("h")
        if h is not None and h > HH: HH = h
    if HH == float("-inf"):
        return ("4_no_high", None)
    if today_close <= HH:
        return ("5_below_HH", {"close": today_close, "HH": round(HH, 2),
                                  "diff_pct": round((today_close - HH) / HH * 100, 2)})

    yest_close = bars[today_idx - 1].get("c")
    if not yest_close:
        return ("6_no_yest_close", None)
    daily_ret = (today_close - yest_close) / yest_close
    if daily_ret < MIN_DAILY_RETURN:
        return ("7_weak_daily_ret",
                {"daily_ret_pct": round(daily_ret * 100, 2)})

    return ("pass", {
        "value1": round(value1, 2), "value2": round(value2, 2),
        "today_close": today_close, "HH": round(HH, 2),
        "above_HH_pct": round((today_close - HH) / HH * 100, 2),
        "daily_ret_pct": round(daily_ret * 100, 2),
    })


def main():
    root = Path(__file__).parent.parent
    stocks = json.loads((root / "frontend/public/data/stocks.json").read_text(encoding="utf-8"))
    klines = json.loads((root / "frontend/public/data/klines.json").read_text(encoding="utf-8"))
    if isinstance(klines, dict) and "klines" in klines:
        klines = klines["klines"]

    DAYS = 60
    PIVOTS = 3
    print(f"=== Diagnostic v4 (XQ kk+HH): days={DAYS}, pivots={PIVOTS} ({pivots_to_high_n(PIVOTS)}d high) ===")
    print(f"stocks: {len(stocks)}, klines keys: {len(klines)}")
    print()

    stage_count = {}
    pass_examples = []

    for s in stocks:
        sid = s["id"]; name = s.get("name", "")
        bars = klines.get(sid)
        stage, info = diagnose(bars, DAYS, PIVOTS, sid, name)
        stage_count[stage] = stage_count.get(stage, 0) + 1
        if stage == "pass":
            pass_examples.append((sid, name, info))

    print("Stage distribution:")
    for stage in sorted(stage_count.keys()):
        print(f"  {stage}: {stage_count[stage]}")
    print()
    print(f"=== PASS examples ({len(pass_examples)}) ===")
    for sid, name, info in pass_examples[:30]:
        print(f"  {sid} {name}: above_HH={info['above_HH_pct']}%, daily_ret={info['daily_ret_pct']}%, v1={info['value1']}, v2={info['value2']}")


if __name__ == "__main__":
    main()
