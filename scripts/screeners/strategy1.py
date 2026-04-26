"""
選股 1 — 5 條件 AND（強勢成長股）

Gate（不過就整個策略歸 0）
  ① 大盤多頭：TWII 20MA > 60MA
  ② 5 日成交金額排名前 100

Per-stock filter
  ③ 股價接近 52 週新高（pctOf52wHigh ≥ NEAR_HIGH_PCT）
  ④ 月營收 YoY ≥ REV_YOY_MIN
  ⑤ 近 3 月漲幅 > RETURN_M3_MIN

Threshold 全部集中在下面 Config，未來想調一行就好。
"""
from __future__ import annotations
from dataclasses import dataclass

from .base import Strategy, ScreenerHit, Stock, MarketContext


@dataclass
class Strategy1Config:
    NEAR_HIGH_PCT: float = 99.0      # 距 52 週高 ≤ 1% 視為「接近新高」（嚴格設 100 = 創新高當日）
    REV_YOY_MIN:   float = 80.0      # 月營收 YoY ≥ 80%（題目給的 RevYoY_Min）
    RETURN_M3_MIN: float = 20.0      # 近 3 月漲幅 > 20%
    TURNOVER_TOP_N: int  = 100       # 5 日成交金額排前 100
    REQUIRE_BULL_MARKET: bool = True # 是否要求大盤多頭（Gate 1）


class Strategy1(Strategy):
    name = "選股 1（強勢成長股）"
    description = "大盤多頭 + 量大 + 創新高 + 月營收爆發 + 中期漲幅"

    def __init__(self, config: Strategy1Config | None = None):
        self.config = config or Strategy1Config()

    def evaluate(
        self,
        stocks: list[Stock],
        market: MarketContext,
    ) -> list[ScreenerHit]:
        cfg = self.config

        # ── Gate 1: 大盤多頭 ──────────────────────────
        if cfg.REQUIRE_BULL_MARKET and market.regime != "bull":
            return []

        # ── Gate 2: 5 日成交金額排前 N ──
        valid_pool = [s for s in stocks if (s.turnovers.get("d5") or 0) > 0]
        sorted_by_turnover = sorted(
            valid_pool,
            key=lambda s: s.turnovers.get("d5") or 0,
            reverse=True,
        )
        top_n = sorted_by_turnover[: cfg.TURNOVER_TOP_N]
        rank_map = {s.id: idx + 1 for idx, s in enumerate(top_n)}

        # ── Per-stock filter ──
        hits: list[ScreenerHit] = []
        for s in top_n:
            # ③ 接近 52 週新高
            if s.pct_of_52w_high is None or s.pct_of_52w_high < cfg.NEAR_HIGH_PCT:
                continue
            # ④ 月營收 YoY
            if s.revenue_yoy is None or s.revenue_yoy < cfg.REV_YOY_MIN:
                continue
            # ⑤ 近 3 月漲幅
            r_m3 = s.returns.get("m3")
            if r_m3 is None or r_m3 <= cfg.RETURN_M3_MIN:
                continue

            hits.append(ScreenerHit(
                stock_id=s.id,
                name=s.name,
                reasons=[
                    f"距高點 {100 - s.pct_of_52w_high:.1f}%",
                    f"月營收 +{s.revenue_yoy:.0f}%",
                    f"3M +{r_m3:.0f}%",
                    f"量第 {rank_map[s.id]}",
                ],
            ))

        return hits
