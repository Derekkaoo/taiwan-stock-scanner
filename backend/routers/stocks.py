# ============================================================
#  routers/stocks.py — /api/stocks 路由
# ============================================================
from __future__ import annotations
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
from datetime import datetime
import logging

from database import get_db
from models import HoldingRecord, StockMeta
from schemas import StocksResponse, StockRow
from grouping import assign_theme_group

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/stocks", tags=["stocks"])


@router.get("", response_model=StocksResponse)
async def get_stocks(
    min_holding: float = Query(default=0.0,  description="最低大股東持股比例（%）"),
    min_delta:   float = Query(default=0.1,  description="最低週增幅（%）"),
    max_price:   float = Query(default=5000, description="股價上限"),
    db: AsyncSession = Depends(get_db),
):
    """
    取得符合條件的股票名單
    條件：大股東（>1000張）持股週增 >= min_delta %
    """
    # 取最新兩週的資料
    result = await db.execute(
        text("SELECT DISTINCT week_date FROM holding_records ORDER BY week_date DESC LIMIT 2")
    )
    weeks = [row[0] for row in result.fetchall()]

    if len(weeks) < 2:
        logger.warning("/api/stocks：DB 中週資料不足，回傳空列表")
        return StocksResponse(data=[], total=0, updated_at=datetime.now().isoformat())

    this_week, last_week = weeks[0], weeks[1]

    # 取本週 level 15 資料
    this_q = await db.execute(
        select(HoldingRecord).where(
            HoldingRecord.week_date == this_week,
            HoldingRecord.level == 15,
        )
    )
    this_rows = {r.stock_id: r for r in this_q.scalars()}

    # 取上週 level 15 資料
    last_q = await db.execute(
        select(HoldingRecord).where(
            HoldingRecord.week_date == last_week,
            HoldingRecord.level == 15,
        )
    )
    last_rows = {r.stock_id: r for r in last_q.scalars()}

    # 取股票基本資料
    meta_q = await db.execute(select(StockMeta))
    meta_map = {m.stock_id: m for m in meta_q.scalars()}

    # 計算 delta 並篩選
    stocks: list[StockRow] = []
    for sid, this_r in this_rows.items():
        last_r = last_rows.get(sid)
        last_ratio = last_r.ratio if last_r else this_r.ratio
        delta = round(this_r.ratio - last_ratio, 4)

        if delta < min_delta:
            continue

        meta = meta_map.get(sid)
        if meta and max_price and meta.price > max_price:
            continue

        stocks.append(StockRow(
            id          = sid,
            name        = meta.name if meta else this_r.stock_name,
            group       = assign_theme_group(sid),
            holdingPct  = this_r.ratio,
            delta       = delta,
            price       = meta.price if meta else 0.0,
            marketCap   = meta.market_cap if meta else 0.0,
            date        = this_week,
        ))

    # 依 delta 降冪排序
    stocks.sort(key=lambda x: x.delta, reverse=True)
    logger.info("/api/stocks 回傳 %d 筆（%s vs %s）", len(stocks), this_week, last_week)

    return StocksResponse(
        data=stocks,
        total=len(stocks),
        updated_at=datetime.now().isoformat(),
    )


@router.get("/trigger-scrape")
async def trigger_scrape():
    """
    手動觸發爬蟲（開發用）
    正式環境使用 APScheduler 定時執行
    """
    from scripts.run_pipeline import run_pipeline
    try:
        count = await run_pipeline()
        return {"status": "ok", "inserted": count}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
