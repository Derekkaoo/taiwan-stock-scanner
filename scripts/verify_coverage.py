#!/usr/bin/env python3
"""
verify_coverage.py — 資料健檢工具

快速檢查 stocks.json 內每支股票是否有完整的：
  1. K 線（bars 非空 + 最近 7 日內有資料）
  2. price > 0
  3. 月營收 YoY + EPS YoY
  4. 三大法人歷史 + 連續買超 streak

非 0 exit code → 有項目未達涵蓋率 threshold（給 push 後驗證 / CI 用）。

用法：
  python scripts/verify_coverage.py            # threshold 85%
  python scripts/verify_coverage.py --strict   # threshold 95%
  python scripts/verify_coverage.py --telegram # fail 時推 Telegram alert
"""
import json
import sys
from pathlib import Path
from datetime import datetime

ROOT = Path(__file__).parent.parent
DATA_DIR = ROOT / "frontend" / "public" / "data"

STRICT      = "--strict"   in sys.argv
TELEGRAM    = "--telegram" in sys.argv
PASS_THRESHOLD = 0.95 if STRICT else 0.85


def _bar(label, pass_count, total, threshold=PASS_THRESHOLD):
    pct = pass_count / total if total else 0
    status = "OK " if pct >= threshold else ("WARN" if pct >= 0.7 else "FAIL")
    bar = "#" * int(pct * 20) + "." * (20 - int(pct * 20))
    print(f"  [{status}] {label:<26} {bar}  {pass_count:>4}/{total:<4}  ({pct*100:5.1f}%)")
    return pct >= threshold, pct, label


def _send_telegram_alert(failures):
    """fail 時推 Telegram；failures = [(label, pct), ...]"""
    try:
        sys.path.insert(0, str(Path(__file__).parent))
        from send_telegram import send_message
    except ImportError:
        print("WARN: send_telegram.py 不可用，跳過 Telegram alert")
        return
    lines = [
        "🚨 <b>資料健檢失敗</b>",
        f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"Threshold: {PASS_THRESHOLD*100:.0f}%",
        "",
        "<b>未通過項目：</b>",
    ]
    for label, pct in failures:
        lines.append(f"• {label}: {pct*100:.1f}%")
    lines.append("")
    lines.append("→ 跑 <code>python scripts/verify_coverage.py</code> 看詳情")
    msg = "\n".join(lines)
    try:
        send_message(msg)
        print("INFO: Telegram alert 已送")
    except Exception as e:
        print(f"WARN: Telegram alert 失敗：{e}")


def main():
    print(f"\n{'='*68}")
    print(f"  資料健檢報告  (threshold = {PASS_THRESHOLD*100:.0f}%)")
    print(f"  Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*68}\n")

    stocks_path = DATA_DIR / "stocks.json"
    if not stocks_path.exists():
        print("FAIL: stocks.json 不存在")
        return 1
    stocks = json.load(open(stocks_path, encoding="utf-8"))
    total = len(stocks)
    print(f"  stocks.json: {total} 支股票\n")

    # ─── K 線 ───
    klines_path = DATA_DIR / "klines.json"
    if not klines_path.exists():
        print("FAIL: klines.json 不存在")
        return 1
    kl = json.load(open(klines_path, encoding="utf-8"))

    today = datetime.now().date()
    has_bars = 0
    fresh_bars = 0
    for s in stocks:
        bars = kl.get(s["id"]) or []
        if not bars:
            continue
        has_bars += 1
        last_str = bars[-1].get("date", "")
        for fmt in ("%Y/%m/%d", "%Y-%m-%d"):
            try:
                last = datetime.strptime(last_str, fmt).date()
                if (today - last).days <= 7:
                    fresh_bars += 1
                break
            except ValueError:
                pass

    checks = [
        _bar("K 線（任一筆 bar）",     has_bars, total),
        _bar("K 線（最近 7 日內）",    fresh_bars, total),
        _bar("price > 0",              sum(1 for s in stocks if (s.get("price") or 0) > 0), total),
        _bar("月營收 YoY",             sum(1 for s in stocks if (s.get("fundamentals", {}).get("revenueYoY") or [])), total),
        _bar("EPS YoY (季財報)",       sum(1 for s in stocks if (s.get("fundamentals", {}).get("epsYoY") or [])), total),
        _bar("institutionalHistory",   sum(1 for s in stocks if (s.get("institutionalHistory") or [])), total),
        _bar("foreignBuyStreak 欄位",  sum(1 for s in stocks if s.get("foreignBuyStreak") is not None), total),
    ]

    failures = [(label, pct) for (passed, pct, label) in checks if not passed]

    print(f"\n{'='*68}")
    if not failures:
        print(f"  PASS: 全部通過（threshold = {PASS_THRESHOLD*100:.0f}%）")
        return 0

    print(f"  FAIL: {len(failures)} 項未達 threshold ({PASS_THRESHOLD*100:.0f}%)")
    if TELEGRAM:
        _send_telegram_alert(failures)
    return 1


if __name__ == "__main__":
    sys.exit(main())
