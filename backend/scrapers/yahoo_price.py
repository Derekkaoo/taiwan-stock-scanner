# ============================================================
#  scrapers/yahoo_price.py
#  Yahoo Finance K 線 + 基本資料抓取
#
#  為什麼選 Yahoo Finance？
#    - 免費，不需 API Key
#    - 支援台股 .TW（上市）/ .TWO（上櫃）格式
#    - 近三個月日 K 只需一次請求（range=3mo）
#
#  已知限制：
#    - Yahoo Finance API 不對外承諾穩定性，URL 可能隨時變動
#    - 若失效，備用方案：
#        A. 富果 API（https://developer.fugle.tw）— 免費帳戶可用
#        B. TWSE OpenAPI（https://openapi.twse.com.tw）— 僅近 60 天
#        C. FinMind API — 免費版 300 次/小時
# ============================================================
import logging
import time
from typing import Optional

import requests

logger = logging.getLogger(__name__)

YAHOO_BASE  = "https://query1.finance.yahoo.com/v8/finance/chart/"
YAHOO_BASE2 = "https://query2.finance.yahoo.com/v8/finance/chart/"  # 備用節點

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
}


def _parse_yahoo_response(data: dict) -> Optional[list[dict]]:
    """解析 Yahoo Finance chart API 回傳的 JSON"""
    try:
        result = data["chart"]["result"][0]
        timestamps = result.get("timestamp", [])
        indicators = result.get("indicators", {})
        ohlcv = indicators.get("quote", [{}])[0]

        bars = []
        for i, ts in enumerate(timestamps):
            c = ohlcv.get("close",  [None])[i]
            if c is None:
                continue
            bars.append({
                "date": time.strftime("%Y/%m/%d", time.localtime(ts)),
                "o":    round(ohlcv.get("open",   [0])[i] or 0, 2),
                "h":    round(ohlcv.get("high",   [0])[i] or 0, 2),
                "l":    round(ohlcv.get("low",    [0])[i] or 0, 2),
                "c":    round(c, 2),
                "v":    ohlcv.get("volume", [0])[i] or 0,
            })
        return bars if len(bars) >= 5 else None
    except (KeyError, IndexError, TypeError) as e:
        logger.debug("Yahoo 解析失敗：%s", e)
        return None


def _get_current_price(data: dict) -> Optional[float]:
    """從 Yahoo API 回應取得最新收盤價"""
    try:
        meta = data["chart"]["result"][0]["meta"]
        return meta.get("regularMarketPrice") or meta.get("previousClose")
    except Exception:
        return None


class YahooPriceFetcher:
    """Yahoo Finance 股價 + K 線抓取器"""

    def __init__(self, timeout: int = 15):
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update(HEADERS)

    def _fetch_symbol(self, symbol: str, range_: str = "3mo") -> Optional[dict]:
        """對指定 symbol（含 .TW/.TWO）發出請求"""
        for base in [YAHOO_BASE, YAHOO_BASE2]:
            try:
                url = f"{base}{symbol}?interval=1d&range={range_}"
                resp = self.session.get(url, timeout=self.timeout)
                resp.raise_for_status()
                return resp.json()
            except requests.RequestException as e:
                logger.debug("Yahoo %s 請求失敗：%s", symbol, e)
        return None

    def fetch_kline(self, stock_id: str) -> Optional[list[dict]]:
        """
        抓取近三個月日 K 線資料
        依序嘗試：.TW（上市）→ .TWO（上櫃）

        回傳：[{date, o, h, l, c, v}, ...] 或 None
        """
        for suffix in [".TW", ".TWO"]:
            symbol = f"{stock_id}{suffix}"
            data = self._fetch_symbol(symbol)
            if data:
                bars = _parse_yahoo_response(data)
                if bars:
                    logger.debug("取得 K 線：%s，%d 根", symbol, len(bars))
                    return bars
        logger.warning("無法取得 K 線：%s", stock_id)
        return None

    def fetch_price(self, stock_id: str) -> Optional[dict]:
        """
        取得最新股價與基本資訊
        回傳：{price, market_cap, name} 或 None
        """
        for suffix in [".TW", ".TWO"]:
            symbol = f"{stock_id}{suffix}"
            data = self._fetch_symbol(symbol, range_="5d")
            if not data:
                continue
            try:
                price = _get_current_price(data)
                meta  = data["chart"]["result"][0]["meta"]
                name  = meta.get("shortName", "")
                # 市值：Yahoo 提供 marketCap（單位：元），轉億元
                market_cap_raw = meta.get("marketCap", 0) or 0
                market_cap = round(market_cap_raw / 1e8, 0)
                if price:
                    return {"price": price, "market_cap": market_cap, "name": name}
            except Exception as e:
                logger.debug("解析 %s 股價失敗：%s", symbol, e)
        return None

    def batch_fetch_klines(
        self,
        stock_ids: list[str],
        delay: float = 0.3,
    ) -> dict[str, list[dict]]:
        """
        批次抓取多支股票 K 線
        加入延遲避免觸發 Yahoo 速率限制
        """
        result = {}
        for i, sid in enumerate(stock_ids):
            bars = self.fetch_kline(sid)
            if bars:
                result[sid] = bars
            if i > 0 and i % 10 == 0:
                time.sleep(delay * 3)  # 每 10 支暫停久一點
            else:
                time.sleep(delay)
            if i % 20 == 0:
                logger.info("K 線進度：%d/%d", i, len(stock_ids))
        return result
