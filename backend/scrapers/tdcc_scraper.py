# ============================================================
#  scrapers/tdcc_scraper.py
#  集保（TDCC）官方 OpenAPI — 股權分散表
#
#  資料來源：
#    臺灣集中保管結算所 OpenAPI
#    文件：https://openapi.tdcc.com.tw
#    政府開放平台：https://data.gov.tw/dataset/11452
#    更新頻率：每週（週五晚間更新上週資料）
#    授權：政府資料開放授權條款-第1版（免費商用）
#
#  持股分級對照（level 欄位）：
#    level  1 = 1~999 股
#    level  2 = 1,000~5,000 股
#    level  3 = 5,001~10,000 股
#    level  4 = 10,001~15,000 股
#    level  5 = 15,001~20,000 股
#    level  6 = 20,001~30,000 股
#    level  7 = 30,001~40,000 股
#    level  8 = 40,001~50,000 股
#    level  9 = 50,001~100,000 股
#    level 10 = 100,001~200,000 股
#    level 11 = 200,001~400,000 股
#    level 12 = 400,001~600,000 股
#    level 13 = 600,001~800,000 股
#    level 14 = 800,001~1,000,000 股
#    level 15 = 1,000,001 股以上   ← 大股東（>1000 張）
#    level 16 = 合計
#    level 17 = 差異數
#
#  我們要的是 level 15 的「占集保庫存數比例%」的週差值
# ============================================================
import logging
import re
from datetime import datetime, timedelta
from typing import Optional

import requests

logger = logging.getLogger(__name__)

# TDCC OpenAPI endpoints
# 不需要 API Key，直接呼叫
TDCC_API_BASE  = "https://openapi.tdcc.com.tw/v1/opendata"
TDCC_ENDPOINT  = f"{TDCC_API_BASE}/t187ap22_L"   # 集保戶股權分散表（全市場）

# 備用：政府開放平台 CSV 下載
# https://data.gov.tw/dataset/11452
GOV_CSV_URL = "https://opendata.tdcc.com.tw/getOD.ashx?id=1-5&key=Open1Data"

HEADERS = {
    "User-Agent": "TaiwanStockScanner/1.0 (educational use)",
    "Accept": "application/json",
}

LARGE_HOLDER_LEVEL = 15   # > 1,000,000 股 = > 1000 張


def _get_recent_fridays(n: int = 2) -> list[str]:
    """
    取得最近 n 個週五日期（TDCC 資料通常在週五後更新）
    回傳格式：["YYYYMMDD", ...]
    """
    today = datetime.now()
    fridays = []
    d = today
    while len(fridays) < n:
        if d.weekday() == 4:  # 4 = Friday
            fridays.append(d.strftime("%Y%m%d"))
        d -= timedelta(days=1)
    return fridays


class TDCCScraper:
    """
    集保 TDCC 股權分散表爬蟲
    主要用途：計算各股票大股東（level 15）的週增減比例
    """

    def __init__(self, timeout: int = 30):
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update(HEADERS)

    def fetch_week_data(self, date_str: str) -> list[dict]:
        """
        取得指定週的全市場股權分散資料
        date_str: "YYYYMMDD" 格式

        回傳：[{stock_id, level, holders, shares, ratio}, ...]
        """
        logger.info("TDCC：抓取 %s 的股權分散表…", date_str)
        try:
            params = {
                "d": date_str,
                "s": "1",  # 1 = 上市，2 = 上櫃
            }
            resp = self.session.get(TDCC_ENDPOINT, params=params, timeout=self.timeout)
            resp.raise_for_status()
            raw: list[dict] = resp.json()
            logger.info("TDCC：取得 %d 筆原始資料（%s）", len(raw), date_str)
            return raw
        except Exception as e:
            logger.error("TDCC API 失敗（%s）：%s", date_str, e)
            return []

    def _normalize_row(self, row: dict) -> Optional[dict]:
        """正規化 TDCC API 回傳的欄位名稱"""
        try:
            # TDCC API 欄位（依官方文件）
            # 若欄位名稱有變動，在此統一調整
            stock_id = str(row.get("證券代號", row.get("StockID", ""))).strip()
            level    = int(row.get("持股分級", row.get("Level", 0)))
            holders  = int(str(row.get("人數",   row.get("Holders", 0))).replace(",", ""))
            shares   = int(str(row.get("股數",   row.get("Shares",  0))).replace(",", ""))
            ratio    = float(str(row.get("占集保庫存數比例%", row.get("Ratio", 0))).replace(",", ""))
            if not stock_id or not re.match(r"^\d{4}", stock_id):
                return None
            return {
                "stock_id": stock_id[:4],
                "level":    level,
                "holders":  holders,
                "shares":   shares,
                "ratio":    ratio,
            }
        except (ValueError, TypeError) as e:
            logger.debug("TDCC 欄位解析失敗：%s，row=%s", e, row)
            return None

    def compute_delta(
        self,
        this_week: list[dict],
        last_week: list[dict],
        min_delta: float = 0.1,
    ) -> list[dict]:
        """
        計算大股東（level 15）本週 vs 上週持股比例差值
        篩選 delta >= min_delta 的股票名單

        回傳：[{stock_id, holding_pct, delta, date}, ...]
        """
        # 建立上週字典：{stock_id: ratio}
        last_map: dict[str, float] = {}
        for row in last_week:
            n = self._normalize_row(row)
            if n and n["level"] == LARGE_HOLDER_LEVEL:
                last_map[n["stock_id"]] = n["ratio"]

        results = []
        for row in this_week:
            n = self._normalize_row(row)
            if not n or n["level"] != LARGE_HOLDER_LEVEL:
                continue
            stock_id    = n["stock_id"]
            holding_pct = n["ratio"]
            last_ratio  = last_map.get(stock_id, holding_pct)
            delta       = round(holding_pct - last_ratio, 4)

            if delta >= min_delta:
                results.append({
                    "stock_id":    stock_id,
                    "holding_pct": holding_pct,
                    "delta":       delta,
                })

        logger.info("TDCC delta 計算完成：%d 筆符合 delta >= %.2f%%", len(results), min_delta)
        return sorted(results, key=lambda x: x["delta"], reverse=True)

    def get_filtered_stocks(
        self,
        min_delta: float = 0.1,
        min_holding_pct: float = 0.0,
    ) -> list[dict]:
        """
        完整流程：抓最近兩週 → 計算 delta → 篩選 → 回傳
        """
        fridays = _get_recent_fridays(2)
        if len(fridays) < 2:
            logger.error("無法取得週五日期")
            return []

        this_week_date = fridays[0]
        last_week_date = fridays[1]

        this_week = self.fetch_week_data(this_week_date)
        last_week = self.fetch_week_data(last_week_date)

        if not this_week:
            logger.warning("TDCC 本週資料為空，嘗試 OTC（上櫃）市場…")
            # 可加入上櫃（s=2）的抓取

        filtered = self.compute_delta(this_week, last_week, min_delta=min_delta)

        # 加入 date 欄位
        for item in filtered:
            item["date"] = f"{this_week_date[:4]}-{this_week_date[4:6]}-{this_week_date[6:]}"

        return filtered
