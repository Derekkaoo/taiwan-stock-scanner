"""
trading_calendar.py — 台股交易日曆共用模組

把「預期最新交易日」這類邏輯集中一處，避免散落在 3 支 script 裡各寫一份還都不考慮國定假日。

依賴：
  pip install holidays

主要用途：
  smart-skip 判斷「現在資料應該更新到哪一天」。例如 5/1 勞動節 TWSE 沒交易，
  原本 expected = 5/1 會永遠 cache miss；改成跳過假日後 expected = 4/30，正確。

公開函式：
  is_trading_day(d)              — 該日是不是台股交易日（週末或國定假日 → False）
  previous_trading_day(d)        — 在 d 之前（不含 d）最近一個交易日
  expected_latest_trading_day(now=None)
                                 — 給 smart-skip 用：到 now 為止資料應該已經有的最新交易日
                                   - now 是交易日且過 14:00（收盤後 30 分有資料）→ 今天
                                   - 否則 → 在 now 之前最近一個交易日
                                   now 可以傳 datetime；不傳就用 TW 現在時間
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Optional

import holidays as _holidays

# Taiwan stock market 跟政府行事曆 99% 一致（少數補班日除外，但補班日不影響「假日」判斷）
# 預載 2024-2030 年（一次取夠用，省 lazy load）
_TW_HOLIDAYS = _holidays.Taiwan(years=range(2024, 2031))


def is_trading_day(d: date) -> bool:
    """週末或國定假日 → False；其餘 → True。"""
    if d.weekday() >= 5:  # 5=Sat 6=Sun
        return False
    if d in _TW_HOLIDAYS:
        return False
    return True


def previous_trading_day(d: date) -> date:
    """d 之前（不含 d）最近一個交易日。"""
    cur = d - timedelta(days=1)
    # 防呆：最多回推 30 天（連假再長也夠）
    for _ in range(30):
        if is_trading_day(cur):
            return cur
        cur -= timedelta(days=1)
    raise RuntimeError(f"找不到 {d} 之前的交易日（連退 30 天都假日？）")


def expected_latest_trading_day(now: Optional[datetime] = None) -> date:
    """資料應該更新到的最近交易日。

    規則：
      - now 是交易日 + 已過 14:00 → 今天（收盤 13:30 後 ~30 分鐘 TWSE 公布資料）
      - 否則 → 在 now 之前最近一個交易日

    Args:
      now: TW 時區 datetime；不傳就用 utcnow + 8 小時（CI 安全）。
    """
    if now is None:
        now = datetime.utcnow() + timedelta(hours=8)

    today = now.date()
    if is_trading_day(today) and now.hour >= 14:
        return today
    return previous_trading_day(today)


__all__ = [
    "is_trading_day",
    "previous_trading_day",
    "expected_latest_trading_day",
]
