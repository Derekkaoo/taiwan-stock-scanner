"""
Yahoo 股市 profile 抓取（公司基本資料 + 業務介紹）

URL：https://tw.stock.yahoo.com/quote/{stock_id}/profile

抓取結構：
  <span>主要經營業務</span>
  <div>...實際業務描述文字...</div>

  <span>董事長</span>
  <div>...名字...</div>

  ... 其他欄位

輸出：
  {
    "id": "2330",
    "name": "台積電",
    "business": "依客戶之訂單與其提供之產品設計說明...",
    "chairman": "魏哲家",
    "ceo": "魏哲家",
    "founded": "1987/02/21",
    "listed": "1994/09/05",
    "capital": "259,303,805,000",
    "address": "新竹市力行六路八號",
    "phone": "(03)5636688",
    "email": "...@tsmc.com",
    "website": "https://www.tsmc.com",
    "industry": "半導體業",
    ...
  }

用法：
  python scripts/fetch_yahoo_profile.py 2330
  python scripts/fetch_yahoo_profile.py 6173
"""
import json
import logging
import sys
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

USER_AGENT = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
              "AppleWebKit/537.36 (KHTML, like Gecko) "
              "Chrome/121.0.0.0 Safari/537.36")

URL_TEMPLATE = "https://tw.stock.yahoo.com/quote/{stock_id}/profile"

# Yahoo 顯示文字 → 我們的英文 key
LABEL_MAP = {
    "主要經營業務":     "business",
    "公司簡稱":         "shortName",
    "英文簡稱":         "englishName",
    "董事長":           "chairman",
    "總經理":           "ceo",
    "發言人":           "spokesman",
    "代理發言人":       "deputySpokesman",
    "成立時間":         "foundedDate",
    "上市時間":         "listedDate",
    "上櫃時間":         "listedDate",
    "股票過戶機構":     "transferAgent",
    "簽證會計師":       "auditor",
    "公司地址":         "address",
    "電話":             "phone",
    "傳真":             "fax",
    "傳真號碼":         "fax",
    "電子郵件":         "email",
    "網址":             "website",
    "公司網址":         "website",
    "實收資本額":       "capital",
    "普通股股本":       "commonStock",
    "已發行普通股數":   "sharesOutstanding",
    "員工人數":         "employees",
    "所屬集團":         "group",
    "統一編號":         "taxId",
    "產業類別":         "industry",
    "產業別":           "industry",
}


def fetch_profile(stock_id, session=None):
    """抓單支股票 profile，回 dict；失敗回 None"""
    if session is None:
        session = requests.Session()
        session.headers.update({
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
        })

    url = URL_TEMPLATE.format(stock_id=stock_id)
    try:
        r = session.get(url, timeout=15)
        if r.status_code != 200:
            logger.warning("[%s] status=%d", stock_id, r.status_code)
            return None
    except Exception as e:
        logger.warning("[%s] 例外：%s", stock_id, e)
        return None

    text = r.content.decode("utf-8", errors="replace")
    if "challenges.cloudflare" in text.lower():
        logger.warning("[%s] Cloudflare blocked", stock_id)
        return None

    soup = BeautifulSoup(text, "lxml")

    # 從 H1 拿股票名稱
    name = ""
    for h1 in soup.find_all("h1"):
        t = h1.get_text(strip=True)
        if t and t != "Yahoo股市" and len(t) <= 20:
            name = t
            break

    result = {"id": stock_id, "name": name}

    # 找所有 label → value 配對
    # Yahoo 結構：<span>label</span> 後面接 <div>value</div>
    for span in soup.find_all("span"):
        label = span.get_text(strip=True)
        if label in LABEL_MAP:
            key = LABEL_MAP[label]
            # 找接著的 div / span 裡的值
            sibling = span.find_next("div")
            if sibling:
                value = sibling.get_text(separator=" ", strip=True)
                # 過濾過長 / 過短的
                if value and len(value) < 2000:
                    result[key] = value

    return result


def main(stock_id):
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(message)s")
    data = fetch_profile(stock_id)
    if not data:
        print(f"失敗 {stock_id}")
        sys.exit(1)
    print(json.dumps(data, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    sid = sys.argv[1] if len(sys.argv) > 1 else "2330"
    main(sid)
