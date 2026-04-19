# ============================================================
#  schemas.py — Pydantic 模型（對應前端 TypeScript types/index.ts）
# ============================================================
from __future__ import annotations
from pydantic import BaseModel, Field
from typing import Optional
from datetime import date


class StockRow(BaseModel):
    """股票基礎資料 — 對應前端 StockRow interface"""
    id:                str
    name:              str
    group:             str = ""
    holdingPct:        float = Field(description="本週大股東持股比例 %")
    delta:             float = Field(description="與上週差異 %")
    price:             float = Field(description="收盤價")
    marketCap:         float = Field(default=0, description="市值（億元）")
    date:              str   = Field(description="資料日期 YYYY-MM-DD")
    threeMonthReturn:  Optional[float] = None


class KlineBar(BaseModel):
    """K 線單根資料"""
    date: str
    o:    float  # 開盤
    h:    float  # 最高
    l:    float  # 最低
    c:    float  # 收盤
    v:    float  # 成交量


class StocksResponse(BaseModel):
    data:        list[StockRow]
    total:       int
    updated_at:  str


class KlineResponse(BaseModel):
    stock_id:    str
    data:        list[KlineBar]
    source:      str = "yahoo"  # "yahoo" | "mock"
    updated_at:  str


class HoldingRow(BaseModel):
    """集保持股分級原始資料"""
    date:         str
    stock_id:     str
    level:        int   # 1~17 分級
    holders:      int   # 持股人數
    shares:       int   # 持股股數
    ratio:        float # 占集保庫存比例 %
