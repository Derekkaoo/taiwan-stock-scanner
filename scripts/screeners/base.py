"""
screeners/base.py — Strategy 抽象 + 共用資料結構

每個策略繼承 Strategy，實作 evaluate() 回傳一串 ScreenerHit。
runner.py 註冊所有策略並依序執行。
"""
from __future__ import annotations
import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent.parent.parent / "frontend" / "public" / "data"
DB_DIR   = Path(__file__).parent.parent.parent / "backend" / "db"

STOCKS_PATH = DATA_DIR / "stocks.json"
TWII_PATH   = DB_DIR / "twii.json"


# ============================================================
#  資料結構
# ============================================================
@dataclass
class ScreenerHit:
    """一支股票符合一個策略的命中記錄"""
    stock_id: str
    name: str
    reasons: list[str] = field(default_factory=list)   # 為什麼符合的條件描述

    def __str__(self):
        joined = " | ".join(self.reasons) if self.reasons else ""
        return f"{self.stock_id} {self.name}  ({joined})"


@dataclass
class Stock:
    """從 stocks.json 解析後的便利物件"""
    id: str
    name: str
    price: float
    market_cap: float                         # 億
    delta: float                              # 大戶本週增持 %
    pct_of_52w_high: Optional[float]          # 0~100；100 = 創新高
    revenue_yoy: Optional[float]              # 月營收 YoY %
    returns: dict                             # {w1, m1, m3, m6, y1}
    turnovers: dict                           # {d1, d5, d10, d20} 億
    volumes: dict                             # {d1, d5, d10, d20} 千張
    fundamentals: dict                        # YoY/abs series
    industry: str
    raw: dict                                 # 原始 dict（fallback 用）

    @classmethod
    def from_dict(cls, d: dict) -> "Stock":
        return cls(
            id=d["id"],
            name=d.get("name", ""),
            price=float(d.get("price") or 0),
            market_cap=float(d.get("marketCap") or 0),
            delta=float(d.get("delta") or 0),
            pct_of_52w_high=d.get("pctOf52wHigh"),
            revenue_yoy=d.get("revenueYoY"),
            returns=d.get("returns") or {},
            turnovers=d.get("turnovers") or {},
            volumes=d.get("volumes") or {},
            fundamentals=d.get("fundamentals") or {},
            industry=d.get("group") or d.get("industry", ""),
            raw=d,
        )


@dataclass
class MarketContext:
    """大盤狀態（給策略看）"""
    twii_close: Optional[float] = None
    twii_ma20:  Optional[float] = None
    twii_ma60:  Optional[float] = None
    regime:     str = "unknown"               # "bull" / "bear" / "unknown"
    date:       str = ""

    @classmethod
    def from_twii_json(cls, path: Path = TWII_PATH) -> "MarketContext":
        if not path.exists():
            logger.warning("twii.json 不存在 — 大盤條件視為 unknown")
            return cls()
        try:
            d = json.loads(path.read_text(encoding="utf-8"))
            return cls(
                twii_close=d.get("close"),
                twii_ma20 =d.get("ma20"),
                twii_ma60 =d.get("ma60"),
                regime    =d.get("regime", "unknown"),
                date      =d.get("date", ""),
            )
        except Exception as e:
            logger.warning("讀 twii.json 失敗：%s", e)
            return cls()


def load_stocks() -> list[Stock]:
    if not STOCKS_PATH.exists():
        logger.error("stocks.json 不存在 — 請先跑 update_klines.py 或 run_pipeline.py")
        return []
    raw = json.loads(STOCKS_PATH.read_text(encoding="utf-8"))
    return [Stock.from_dict(s) for s in raw]


# ============================================================
#  Strategy 抽象
# ============================================================
class Strategy:
    """所有 screener 策略繼承這個。"""
    name: str = "Strategy"                    # 顯示用名字
    description: str = ""                     # 一行說明（可選）

    def evaluate(
        self,
        stocks: list[Stock],
        market: MarketContext,
    ) -> list[ScreenerHit]:
        raise NotImplementedError
