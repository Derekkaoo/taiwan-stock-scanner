import logging
import re
import requests
from bs4 import BeautifulSoup
from dataclasses import dataclass

logger = logging.getLogger(__name__)

NORWAY_URL = (
    "https://norway.twsthr.info/StockHoldersContinue.aspx"
    "?Show=2&continue=Y&weeks=1&growthrate=0.1"
    "&beforeweek=1&price=5000&valuerank=1-3000&display=0"
)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
}


@dataclass
class RawStockRow:
    id: str
    name: str
    holding_pct: float
    delta: float
    price: float
    market_cap: float
    date: str


class NorwayScraper:
    def __init__(self, timeout=30):
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update(HEADERS)

    def fetch(self):
        logger.info("開始爬取 norway.twsthr.info ...")
        resp = self.session.get(NORWAY_URL, timeout=self.timeout)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "lxml")

        # 找含「股票」header 且超過 10 行的表格
        data_table = None
        for t in soup.find_all("table"):
            ths = [th.text.strip() for th in t.find_all("th")]
            if any("股票" in h for h in ths):
                if len(t.find_all("tr")) > 10:
                    data_table = t

        if not data_table:
            logger.warning("找不到資料表格")
            return []

        # 從 th 抓日期（格式 20260417）
        date_str = ""
        for th in data_table.find_all("th"):
            txt = th.text.strip()
            if re.match(r"^\d{8}$", txt):
                date_str = txt[:4] + "-" + txt[4:6] + "-" + txt[6:]
                break

        results = []
        for r in data_table.find_all("tr"):
            tds = r.find_all("td")
            if len(tds) < 7:
                continue

            # 第 4 欄：「1210 大成」格式
            cell = tds[3].text.strip()
            m = re.match(r"^(\d{4})\s+(.+)$", cell)
            if not m:
                continue

            stock_id = m.group(1)
            name = m.group(2).strip()

            try:
                # 第 6 欄：delta（週增幅）
                delta_text = tds[5].text.strip()
                delta = float(delta_text)

                # 第 7 欄：「0.4459.58」= delta + 本週持股比例 拼在一起
                col6 = tds[6].text.strip()
                holding_str = col6.replace(delta_text, "", 1)
                holding_pct = float(holding_str)

                results.append(RawStockRow(
                    id=stock_id,
                    name=name,
                    holding_pct=holding_pct,
                    delta=delta,
                    price=0.0,
                    market_cap=0.0,
                    date=date_str,
                ))
            except Exception as e:
                logger.debug("解析失敗: %s", e)
                continue

        logger.info("norway scraper 解析完成：%d 筆", len(results))
        return results