# ============================================================
#  models.py — SQLAlchemy ORM 資料模型
# ============================================================
from sqlalchemy import Column, String, Float, Integer, DateTime, UniqueConstraint, Index
from sqlalchemy.sql import func
from database import Base


class HoldingRecord(Base):
    """
    集保股權分散表 — 每週原始資料
    來源：TDCC OpenAPI  /v1/opendata/t187ap22_L
          或 norway.twsthr.info 解析後正規化
    """
    __tablename__ = "holding_records"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    week_date   = Column(String(10), nullable=False, index=True)  # YYYY-MM-DD (週結算日)
    stock_id    = Column(String(10), nullable=False, index=True)  # 股票代號
    stock_name  = Column(String(50), nullable=False, default="")
    level       = Column(Integer,   nullable=False)               # 持股分級 1~17
    holders     = Column(Integer,   nullable=False, default=0)    # 持股人數
    shares      = Column(Integer,   nullable=False, default=0)    # 持股股數
    ratio       = Column(Float,     nullable=False, default=0.0)  # 占集保比例 %
    created_at  = Column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("week_date", "stock_id", "level", name="uq_holding"),
        Index("ix_holding_week_stock", "week_date", "stock_id"),
    )


class StockMeta(Base):
    """
    股票基本資料（名稱、市值、收盤價）
    每日或每週更新
    """
    __tablename__ = "stock_meta"

    stock_id    = Column(String(10), primary_key=True)
    name        = Column(String(50), nullable=False, default="")
    price       = Column(Float,      nullable=False, default=0.0)
    market_cap  = Column(Float,      nullable=False, default=0.0)  # 億元
    industry    = Column(String(50), nullable=False, default="")
    market      = Column(String(10), nullable=False, default="")   # "TSE" | "OTC"
    updated_at  = Column(DateTime, server_default=func.now(), onupdate=func.now())


class KlineCache(Base):
    """
    K 線資料快取（近三個月，每日）
    避免每次請求都打 Yahoo Finance
    """
    __tablename__ = "kline_cache"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    stock_id    = Column(String(10), nullable=False, index=True)
    bar_date    = Column(String(10), nullable=False)  # YYYY-MM-DD
    open_p      = Column(Float, nullable=False)
    high_p      = Column(Float, nullable=False)
    low_p       = Column(Float, nullable=False)
    close_p     = Column(Float, nullable=False)
    volume      = Column(Float, nullable=False, default=0)
    fetched_at  = Column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("stock_id", "bar_date", name="uq_kline"),
    )
