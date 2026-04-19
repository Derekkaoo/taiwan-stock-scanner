# ============================================================
#  database.py — SQLAlchemy + SQLite 設定
#  使用 aiosqlite 支援 async，適合 FastAPI
# ============================================================
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
import os

# SQLite 路徑：優先讀環境變數，否則放在 backend/ 目錄下
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./stock_data.db")

engine = create_async_engine(
    DATABASE_URL,
    echo=False,           # 設 True 可看 SQL debug
    pool_pre_ping=True,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)

class Base(DeclarativeBase):
    pass

async def get_db():
    """FastAPI dependency — 取得 async DB session"""
    async with AsyncSessionLocal() as session:
        yield session

async def init_db():
    """建立所有資料表（若不存在）"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
