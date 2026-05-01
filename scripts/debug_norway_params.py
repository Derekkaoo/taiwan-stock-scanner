"""測試 norway URL 各種 growthrate 參數，看哪個能拿到全部股票"""
import requests
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip, deflate",
    "Referer": "https://norway.twsthr.info/",
}

# 測試各種 growthrate 值
tests = [
    "0.1",        # 原本（>= 0.1%）
    "0",          # >= 0%
    "0.0",
    "-0.1",
    "-1",
    "-99",
    "-100",
    "",           # 空
]

sess = requests.Session()
sess.get("https://norway.twsthr.info/", headers=HEADERS, timeout=15)

for gr in tests:
    url = (f"https://norway.twsthr.info/StockHoldersContinue.aspx"
           f"?Show=2&continue=Y&weeks=1&growthrate={gr}"
           f"&beforeweek=1&price=5000&valuerank=1-3000&display=0")
    try:
        r = sess.get(url, headers=HEADERS, timeout=30)
        soup = BeautifulSoup(r.text, "lxml")
        tables = [t for t in soup.find_all("table")
                  if any("股票" in (th.text or "") for th in t.find_all("th"))
                  and len(t.find_all("tr")) > 10]
        total_rows = sum(len(t.find_all("tr")) - 1 for t in tables)
        print(f"  growthrate={gr!r:<10}  status={r.status_code}  len={len(r.text):>6}  tables={len(tables)}  rows={total_rows}")
    except Exception as e:
        print(f"  growthrate={gr!r:<10}  ERROR: {e}")
