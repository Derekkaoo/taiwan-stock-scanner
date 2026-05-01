"""
debug_norway.py
診斷 norway.twsthr.info 抓取問題：到底拿到什麼 HTML
跑法： python scripts/debug_norway.py
"""
import requests
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": (
        "text/html,application/xhtml+xml,application/xml;q=0.9,"
        "image/avif,image/webp,image/apng,*/*;q=0.8"
    ),
    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip, deflate",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Cache-Control": "max-age=0",
}

url = (
    "https://norway.twsthr.info/StockHoldersContinue.aspx"
    "?Show=2&continue=Y&weeks=1&growthrate=0.1"
    "&beforeweek=1&price=5000&valuerank=1-3000&display=0"
)

print("=" * 70)
print("Step 0: GET homepage 拿 cookies")
print("=" * 70)
sess = requests.Session()
home = sess.get("https://norway.twsthr.info/", headers=HEADERS, timeout=15)
print(f"Status: {home.status_code}")
# 改用 list comprehension 避免 dict() 在重複名稱 cookie 上炸
cookies_list = [(c.name, str(c.value)[:40], c.domain, c.path) for c in sess.cookies]
print(f"Cookies count: {len(cookies_list)}")
for name, val, domain, path in cookies_list:
    print(f"  {name} = {val}  (domain={domain}, path={path})")

print()
print("=" * 70)
print("Step 1: GET StockHoldersContinue.aspx")
print("=" * 70)
r = sess.get(url, headers={**HEADERS, "Referer": "https://norway.twsthr.info/"}, timeout=30)
print(f"Status: {r.status_code}")
print(f"Final URL: {r.url}")
print(f"Content-Type: {r.headers.get('Content-Type')}")
print(f"Length: {len(r.text)} chars")

print()
print("=" * 70)
print("HTML 前 2000 字元（讓我看是不是 Cloudflare 中介頁 / 結構改了）")
print("=" * 70)
print(r.text[:2000])

print()
print("=" * 70)
print("Table 結構分析")
print("=" * 70)
soup = BeautifulSoup(r.text, "lxml")
tables = soup.find_all("table")
print(f"Total <table>: {len(tables)}")
for i, t in enumerate(tables):
    ths = [th.text.strip() for th in t.find_all("th")]
    trs = t.find_all("tr")
    print(f"  table[{i}]: {len(trs)} rows, ths sample: {ths[:6]}")

# 把完整 HTML 存檔備查
out = "norway_debug.html"
with open(out, "w", encoding="utf-8") as f:
    f.write(r.text)
print()
print(f"完整 HTML 存到 {out}（可以用瀏覽器打開看）")
