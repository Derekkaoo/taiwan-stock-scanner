"""
Yahoo 股市財報 fallback scraper

當 FinMind 額度用完時的備援。

策略：抓 /income-statement 頁面，內嵌 React app JSON。
每季有完整 income statement 原始值：
  {"date":"2025-09-01...","revenue":"989918318000","grossProfit":"588542829000",
   "operatingProfit":"500684818000","eps":"17.44", ...}

最新一季多了預先算好的 grossMargin/operatingMargin，但歷史季別沒有，
所以我們一律自己算（margin = profit / revenue * 100）。

date 月份對應到季別：3→Q1、6→Q2、9→Q3、12→Q4。
date 月份 = 1（如 2025-01-01）= 年度合計，跳過。
"""
import json
import logging
import re
import sys

import requests

logger = logging.getLogger(__name__)

USER_AGENT = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
              "AppleWebKit/537.36 (KHTML, like Gecko) "
              "Chrome/121.0.0.0 Safari/537.36")

URL = "https://tw.stock.yahoo.com/quote/{id}.TW/income-statement"

QUARTERS_BACK = 8

# 找 date 標記，不限制 body 長度（用 \D 邊界 / 直接搜 fields 更穩）
DATE_RE = re.compile(r'"date":"(\d{4})-(\d{2})-01T[^"]*"')

# 在 date 之後抓欄位（限制範圍 1500 字內、避免跨 record）
def _field(html, start, name, end):
    m = re.search(rf'"{name}":"([\-\d.]+)"', html[start:end])
    if not m:
        return None
    try:
        return float(m.group(1))
    except ValueError:
        return None


def _extract_records(html):
    """回傳 {quarter_str: {revenue, grossProfit, operatingProfit, eps}}"""
    by_q = {}
    matches = list(DATE_RE.finditer(html))
    for i, m in enumerate(matches):
        year = int(m.group(1))
        month = int(m.group(2))
        if month not in (3, 6, 9, 12):
            continue
        qn = (month - 1) // 3 + 1
        qstr = f"{year}Q{qn}"
        # body = 從這個 date 結束到下一個 date 之前
        start = m.end()
        end = matches[i+1].start() if i+1 < len(matches) else min(len(html), start + 2000)

        rec = by_q.setdefault(qstr, {})
        for key in ("revenue", "grossProfit", "operatingProfit", "eps"):
            if key not in rec:
                v = _field(html, start, key, end)
                if v is not None:
                    rec[key] = v

    return by_q


def _build_series(by_q):
    quarters = sorted(by_q.keys())

    def gm(q):
        d = by_q.get(q, {})
        rev, gp = d.get("revenue"), d.get("grossProfit")
        if rev and gp and rev > 0:
            return gp / rev * 100
        return None

    def om(q):
        d = by_q.get(q, {})
        rev, op = d.get("revenue"), d.get("operatingProfit")
        if rev and op and rev > 0:
            return op / rev * 100
        return None

    def eps(q):
        return by_q.get(q, {}).get("eps")

    def yoy_series(metric):
        out = []
        for q in quarters:
            curr = metric(q)
            y, qn = q.split("Q")
            prev_q = f"{int(y)-1}Q{qn}"
            prev = metric(prev_q)
            if curr is not None and prev is not None and abs(prev) > 0.001:
                out.append({"quarter": q, "yoy": round((curr - prev) / abs(prev) * 100, 2)})
        return out[-QUARTERS_BACK:]

    def abs_series(metric):
        out = []
        for q in quarters:
            v = metric(q)
            if v is not None:
                out.append({"quarter": q, "value": round(v, 2)})
        return out[-QUARTERS_BACK:]

    return {
        "grossMarginYoY":     yoy_series(gm),
        "operatingMarginYoY": yoy_series(om),
        "epsYoY":             yoy_series(eps),
        "grossMargin":        abs_series(gm),
        "operatingMargin":    abs_series(om),
        "eps":                abs_series(eps),
    }


def _make_session():
    s = requests.Session()
    s.headers.update({
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
    })
    return s


def fetch_yahoo_financials(stock_id, session=None):
    s = session or _make_session()
    try:
        r = s.get(URL.format(id=stock_id), timeout=15)
        if r.status_code != 200:
            logger.debug("[%s] Yahoo status=%d", stock_id, r.status_code)
            return {}
        html = r.content.decode("utf-8", errors="replace")
        if "challenges.cloudflare" in html.lower():
            logger.warning("[%s] Yahoo Cloudflare blocked", stock_id)
            return {}
    except Exception as e:
        logger.debug("[%s] Yahoo 例外：%s", stock_id, e)
        return {}

    by_q = _extract_records(html)
    if not by_q:
        return {}
    return _build_series(by_q)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    if len(sys.argv) < 2:
        print("用法：python scripts/scrape_yahoo_financials.py 2330")
        sys.exit(1)
    sid = sys.argv[1]
    result = fetch_yahoo_financials(sid)
    print(json.dumps(result, ensure_ascii=False, indent=2))
