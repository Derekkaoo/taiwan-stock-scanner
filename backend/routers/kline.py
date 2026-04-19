# ============================================================
#  routers/kline.py — /api/kline/{stock_id} 路由
# ============================================================
from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timedelta
import logging

from database import get_db
from models import KlineCache
from schemas import KlineResponse, KlineBar

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/kline", tags=["kline"])


@router.get("/{stock_id}", response_model=KlineResponse)
async def get_kline(
    stock_id: str,
    range_: str = Query(default="3mo", alias="range", description="資料範圍：3mo / 6mo / 1y"),
    db: AsyncSession = Depends(get_db),
):
    """
    取得股票 K 線資料（近三個月）
    流程：DB 快取 → Yahoo Finance → Mock fallback
    """
    stock_id = stock_id.strip()[:4]

    # 計算起始日期
    months_map = {"3mo": 90, "6mo": 180, "1y": 365}
    days = months_map.get(range_, 90)
    start_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")

    # 查 DB 快取
    cache_q = await db.execute(
        select(KlineCache)
        .where(KlineCache.stock_id == stock_id, KlineCache.bar_date >= start_date)
        .order_by(KlineCache.bar_date)
    )
    cached = cache_q.scalars().all()

    # 若快取夠新（最新一筆在 3 天內），直接回傳
    if cached:
        latest = cached[-1].bar_date
        if (datetime.now() - datetime.strptime(latest, "%Y-%m-%d")).days <= 3:
            logger.debug("K 線快取命中：%s，%d 根", stock_id, len(cached))
            return KlineResponse(
                stock_id   = stock_id,
                data       = [_to_bar(c) for c in cached],
                source     = "cache",
                updated_at = datetime.now().isoformat(),
            )

    # 快取過舊或不存在，重新抓取
    from scrapers.yahoo_price import YahooPriceFetcher
    fetcher = YahooPriceFetcher()
    bars = fetcher.fetch_kline(stock_id)

    if not bars:
        if cached:
            # 至少回傳舊快取
            return KlineResponse(
                stock_id   = stock_id,
                data       = [_to_bar(c) for c in cached],
                source     = "stale-cache",
                updated_at = datetime.now().isoformat(),
            )
        raise HTTPException(status_code=404, detail=f"無法取得 {stock_id} 的 K 線資料")

    # 寫入快取（upsert）
    for bar in bars:
        bar_date = bar["date"].replace("/", "-")
        existing = await db.execute(
            select(KlineCache).where(
                KlineCache.stock_id == stock_id,
                KlineCache.bar_date == bar_date,
            )
        )
        row = existing.scalar_one_or_none()
        if row:
            row.open_p  = bar["o"]
            row.high_p  = bar["h"]
            row.low_p   = bar["l"]
            row.close_p = bar["c"]
            row.volume  = bar["v"]
        else:
            db.add(KlineCache(
                stock_id = stock_id,
                bar_date = bar_date,
                open_p   = bar["o"],
                high_p   = bar["h"],
                low_p    = bar["l"],
                close_p  = bar["c"],
                volume   = bar["v"],
            ))

    await db.commit()
    logger.info("K 線已更新快取：%s，%d 根", stock_id, len(bars))

    return KlineResponse(
        stock_id   = stock_id,
        data       = [KlineBar(date=b["date"], o=b["o"], h=b["h"], l=b["l"], c=b["c"], v=b["v"])
                      for b in bars],
        source     = "yahoo",
        updated_at = datetime.now().isoformat(),
    )


def _to_bar(c: KlineCache) -> KlineBar:
    return KlineBar(date=c.bar_date, o=c.open_p, h=c.high_p, l=c.low_p, c=c.close_p, v=c.volume)
