# ============================================================
#  scrapers/__init__.py
#  爬蟲策略 Registry — 統一管理各資料來源
#
#  設計理念：
#    - 每種資料來源為一個獨立 class，實作相同介面
#    - Registry 依優先順序嘗試，第一個成功即回傳
#    - 方便日後新增 / 切換資料來源，不需改動 API 層
# ============================================================
from __future__ import annotations
import logging
from typing import Protocol, runtime_checkable
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@runtime_checkable
class HoldingDataSource(Protocol):
    """持股資料來源介面"""
    name: str
    def fetch(self) -> list[dict]: ...


@dataclass
class SourceResult:
    source: str
    data:   list[dict]
    ok:     bool
    error:  str = ""


class ScraperRegistry:
    """
    爬蟲策略登錄表
    按優先順序嘗試所有來源，第一個成功即回傳
    """

    def __init__(self):
        self._sources: list[tuple[int, object]] = []

    def register(self, source: object, priority: int = 10):
        """priority 越小越優先"""
        self._sources.append((priority, source))
        self._sources.sort(key=lambda x: x[0])
        logger.info("Registry：已登錄資料來源 %s（priority=%d）",
                    getattr(source, "name", type(source).__name__), priority)

    def fetch_all(self) -> SourceResult:
        """依優先順序嘗試，回傳第一個成功的結果"""
        for priority, source in self._sources:
            name = getattr(source, "name", type(source).__name__)
            logger.info("Registry：嘗試 %s（priority=%d）…", name, priority)
            try:
                data = source.fetch()  # type: ignore[attr-defined]
                if data:
                    logger.info("Registry：%s 成功，取得 %d 筆", name, len(data))
                    return SourceResult(source=name, data=data, ok=True)
                logger.warning("Registry：%s 回傳空資料", name)
            except Exception as e:
                logger.warning("Registry：%s 失敗：%s", name, e)

        return SourceResult(source="none", data=[], ok=False, error="所有資料來源均失敗")


# ── 預設 Registry 實例（在 main.py 中組裝） ──────────────────
registry = ScraperRegistry()
