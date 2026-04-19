# ============================================================
#  main.py — FastAPI 應用程式入口
#
#  啟動方式：
#    cd backend
#    python -m venv venv && source venv/bin/activate  # Windows: venv\Scripts\activate
#    pip install -r requirements.txt
#    uvicorn main:app --reload --port 8000
# ============================================================
from __future__ import annotations
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from database import init_db
from routers.stocks import router as stocks_router
from routers.kline import router as kline_router
from scrapers import registry
from scrapers.norway_scraper import NorwayScraper
from scrapers.tdcc_scraper import TDCCScraper

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)

# ── APScheduler 定時排程 ──────────────────────────────────────
scheduler = AsyncIOScheduler(timezone="Asia/Taipei")


async def scheduled_scrape():
    """每週六 07:00 自動抓取（集保通常週五晚更新）"""
    logger.info("=== 定時爬蟲啟動 %s ===", datetime.now().isoformat())
    from scripts.run_pipeline import run_pipeline
    try:
        count = await run_pipeline()
        logger.info("=== 定時爬蟲完成，新增 %d 筆 ===", count)
    except Exception as e:
        logger.error("=== 定時爬蟲失敗：%s ===", e)


# ── 應用程式生命週期 ──────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    # 啟動時
    logger.info("FastAPI 啟動，初始化 DB…")
    await init_db()

    # 組裝爬蟲 Registry（依優先順序）
    # priority 1：norway.twsthr.info（最詳細，直接含篩選條件）
    # priority 2：TDCC OpenAPI（官方資料，需自行計算 delta）
    norway  = NorwayScraper()
    tdcc    = TDCCScraper()

    # 包裝成統一介面
    class NorwayAdapter:
        name = "norway.twsthr.info"
        def fetch(self): return [vars(r) for r in norway.fetch()]

    class TDCCAdapter:
        name = "TDCC OpenAPI"
        def fetch(self): return tdcc.get_filtered_stocks()

    registry.register(NorwayAdapter(),  priority=1)
    registry.register(TDCCAdapter(),    priority=2)

    # 定時排程：每週六 07:00
    scheduler.add_job(scheduled_scrape, "cron", day_of_week="sat", hour=7, minute=0)
    scheduler.start()
    logger.info("定時排程已啟動（每週六 07:00）")

    yield

    # 關閉時
    scheduler.shutdown()
    logger.info("FastAPI 關閉")


# ── FastAPI App ───────────────────────────────────────────────
app = FastAPI(
    title="台股大股東持股觀察 API",
    description="提供大股東持股變化資料與 K 線資料",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS 設定：允許前端 localhost:5173 與 Firebase Hosting
ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:5174",
    os.getenv("FRONTEND_URL", "https://your-project.web.app"),
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# 路由
app.include_router(stocks_router)
app.include_router(kline_router)


@app.get("/")
async def root():
    return {
        "service": "台股大股東持股觀察 API",
        "version": "1.0.0",
        "docs": "/docs",
        "status": "ok",
    }


@app.get("/health")
async def health():
    return {"status": "ok", "time": datetime.now().isoformat()}


# ── 全域例外處理 ──────────────────────────────────────────────
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    logger.error("未預期的例外：%s %s — %s", request.method, request.url, exc)
    return JSONResponse(
        status_code=500,
        content={"detail": "內部伺服器錯誤，請查看後端 log"},
    )
