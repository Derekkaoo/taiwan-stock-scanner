"""
選股 2 — 13 條件 AND（短中長線多頭強勢、量能爆發、籌碼集中）

條件清單（對應使用者截圖編號）：
  ① 成交量 > VOL_LOTS_MIN 張
  ② 均線多頭排列：ma10 > ma20 > ma60
  ③ 收盤價創 200 日新高（pctOf200dHigh ≥ HIGH_200D_PCT）
  ④ 成交量 > 5 日均量 ×VOL_VS_5D_MUL
  ⑤ 20MA 朝上（ma20Trend == "up"）
  ⑦ 1 日成交金額 > 10 週均（turnovers.d1 > turnovers.d50）
  ⑧ 今日漲幅 > DAILY_CHANGE_MIN %
  ⑨ 1 日成交量 > 10 週均量（volumes.d1 > volumes.d50）
  ⑩ 大盤在季線上（TWII close > 60MA）
  ⑪ 近 N 日內三大法人「曾」同步買超
  ⑫ 近 4 週收盤漲幅排前 N（returns.m1 排序）
  ⑬ 近 1 日成交金額排前 N（turnovers.d1 排序）
  ⑭ 月營收 YoY > REV_YOY_MIN %

Threshold 集中在 Strategy2Config。
"""
from __future__ import annotations
from dataclasses import dataclass

from .base import Strategy, ScreenerHit, Stock, MarketContext, load_institutional


@dataclass
class Strategy2Config:
    VOL_LOTS_MIN:      float = 300.0     # ① 成交量門檻（張）
    HIGH_200D_PCT:     float = 99.5      # ③ 接近 200 日新高（≤ 0.5%）
    VOL_VS_5D_MUL:     float = 1.0       # ④ 成交量 > 5 日均的倍數
    DAILY_CHANGE_MIN:  float = 3.0       # ⑧ 今日漲幅 %
    INST_RECENT_DAYS:  int   = 20        # ⑪ 三大法人觀察天期
    M1_TOP_N:          int   = 200       # ⑫ 近 4 週漲幅排前 N
    D1_TURNOVER_TOP_N: int   = 100       # ⑬ 近 1 日成交金額排前 N
    REV_YOY_MIN:       float = 40.0      # ⑭ 月營收 YoY


def _all_three_buying(record: dict) -> bool:
    """單日三大法人是否同步買超（外資 / 投信 / 自營商皆 > 0）"""
    return (record.get("foreign", 0) > 0
            and record.get("trust",   0) > 0
            and record.get("dealer",  0) > 0)


class Strategy2(Strategy):
    name = "選股 2（13 條件多頭強勢）"
    description = "短中長線均線多頭 + 量能爆發 + 創 200 日高 + 三大法人同步買超 + 月營收成長"

    def __init__(self, config: Strategy2Config | None = None):
        self.config = config or Strategy2Config()
        self._inst_data = None   # lazy load

    def _inst(self):
        if self._inst_data is None:
            self._inst_data = load_institutional()
        return self._inst_data

    def evaluate(
        self,
        stocks: list[Stock],
        market: MarketContext,
    ) -> list[ScreenerHit]:
        cfg = self.config

        # ─── ⑩ Gate: 大盤在季線上 ───
        if market.twii_close is None or market.twii_ma60 is None:
            return []
        if market.twii_close <= market.twii_ma60:
            return []

        # ─── 預排序 ranking（⑫⑬）───
        m1_sorted = sorted(
            (s for s in stocks if s.returns.get("m1") is not None),
            key=lambda s: s.returns.get("m1") or -999,
            reverse=True,
        )[: cfg.M1_TOP_N]
        m1_set = {s.id for s in m1_sorted}

        d1_sorted = sorted(
            (s for s in stocks if (s.turnovers.get("d1") or 0) > 0),
            key=lambda s: s.turnovers.get("d1") or 0,
            reverse=True,
        )[: cfg.D1_TURNOVER_TOP_N]
        d1_rank = {s.id: idx + 1 for idx, s in enumerate(d1_sorted)}

        # ─── 三大法人 lookup ───
        inst = self._inst()

        hits: list[ScreenerHit] = []
        for s in stocks:
            # ① 成交量 > 300 張（volumes.d1 在 stocks.json 是「千張」單位 = ÷1000 後）
            # 注意：後端 update_klines.py 內 volumes.d1 是「千張」(0.3 = 300 張)
            vol_d1_lots = (s.volumes.get("d1") or 0) * 1000   # 千張 → 張
            if vol_d1_lots <= cfg.VOL_LOTS_MIN:
                continue

            # ② 均線多頭排列（10 > 20 > 60）
            if not (s.ma10 and s.ma20 and s.ma60 and s.ma10 > s.ma20 > s.ma60):
                continue

            # ③ 200 日新高
            if s.pct_of_200d_high is None or s.pct_of_200d_high < cfg.HIGH_200D_PCT:
                continue

            # ④ 量 > 5 日均 ×N
            v5 = s.volumes.get("d5") or 0
            if v5 <= 0 or (s.volumes.get("d1") or 0) < v5 * cfg.VOL_VS_5D_MUL:
                continue

            # ⑤ 20MA 朝上
            if s.ma20_trend != "up":
                continue

            # ⑦ 1 日成交金額 > 10 週均
            t50 = s.turnovers.get("d50") or 0
            if t50 <= 0 or (s.turnovers.get("d1") or 0) <= t50:
                continue

            # ⑧ 今日漲幅
            if s.daily_change_pct is None or s.daily_change_pct <= cfg.DAILY_CHANGE_MIN:
                continue

            # ⑨ 1 日量 > 10 週均量
            if v5 <= 0:   # safeguard，已在 ④ 過
                continue
            v50 = s.volumes.get("d50") or 0
            if v50 <= 0 or (s.volumes.get("d1") or 0) <= v50:
                continue

            # ⑪ 近 N 日三大法人曾同步買超
            history = (inst.get(s.id) or [])[-cfg.INST_RECENT_DAYS:]
            if not any(_all_three_buying(r) for r in history):
                continue

            # ⑫ 近 4 週漲幅 Top N
            if s.id not in m1_set:
                continue

            # ⑬ 1 日成交金額 Top N
            if s.id not in d1_rank:
                continue

            # ⑭ 月營收 YoY
            if s.revenue_yoy is None or s.revenue_yoy <= cfg.REV_YOY_MIN:
                continue

            # 命中！
            r_m1 = s.returns.get("m1") or 0
            hits.append(ScreenerHit(
                stock_id=s.id,
                name=s.name,
                reasons=[
                    f"距200高{100 - s.pct_of_200d_high:.1f}%",
                    f"日漲+{s.daily_change_pct:.1f}%",
                    f"4W +{r_m1:.0f}%",
                    f"月營收+{s.revenue_yoy:.0f}%",
                    f"量第{d1_rank[s.id]}",
                ],
            ))

        return hits
