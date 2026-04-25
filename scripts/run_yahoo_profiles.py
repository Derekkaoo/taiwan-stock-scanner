"""
批次抓取所有股票的 Yahoo profile，輸出 backend/db/yahoo_profiles.json

特色：
- Smart cache：profile 變動慢（董事長 / 業務描述基本上一年才變一次），預設 30 天才重抓
- 只抓 stocks.json 內的股票（節省時間）
- 中途存檔（每 50 支寫一次，當機不會全沒）
- 失敗自動重試 1 次

用法：
  python scripts/run_yahoo_profiles.py             # 自動 smart check
  python scripts/run_yahoo_profiles.py --force     # 全部重抓
  python scripts/run_yahoo_profiles.py --max-age 7 # 7 天以上才重抓
"""
import json
import logging
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import fetch_yahoo_profile

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent.parent / "frontend" / "public" / "data"
DB_DIR = Path(__file__).parent.parent / "backend" / "db"
PROFILES_PATH = DB_DIR / "yahoo_profiles.json"


def load_existing():
    if not PROFILES_PATH.exists():
        return {}
    try:
        with open(PROFILES_PATH, encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.warning("讀 yahoo_profiles.json 失敗：%s", e)
        return {}


def is_fresh(entry, max_age_days):
    """profile 是否還在 max_age_days 內"""
    fetched_at = entry.get("_fetched_at", "")
    if not fetched_at:
        return False
    try:
        when = datetime.strptime(fetched_at[:10], "%Y-%m-%d")
        age = (datetime.now() - when).days
        return age < max_age_days
    except ValueError:
        return False


def run(force=False, max_age_days=30, delay=1.5):
    today = datetime.utcnow() + timedelta(hours=8)
    today_str = today.strftime("%Y-%m-%d")

    logger.info("=== Yahoo Profile 批次抓取 ===")
    logger.info("max_age=%d 天，force=%s", max_age_days, force)

    stocks_path = DATA_DIR / "stocks.json"
    if not stocks_path.exists():
        logger.error("找不到 stocks.json")
        return
    with open(stocks_path, encoding="utf-8") as f:
        stocks = json.load(f)
    stock_ids = [s["id"] for s in stocks]
    logger.info("股票清單：%d 支", len(stock_ids))

    existing = load_existing()
    logger.info("既存 profile：%d 支", len(existing))

    # 決定要抓誰
    to_fetch = []
    for sid in stock_ids:
        if force:
            to_fetch.append(sid)
        else:
            entry = existing.get(sid)
            if not entry or not is_fresh(entry, max_age_days):
                to_fetch.append(sid)

    if not to_fetch:
        logger.info("✓ 全部 profile 都還新鮮，無需更新")
        return

    logger.info("需要抓 %d 支（%d 支已新鮮跳過）",
                len(to_fetch), len(stock_ids) - len(to_fetch))

    DB_DIR.mkdir(parents=True, exist_ok=True)

    import requests
    session = requests.Session()
    session.headers.update({
        "User-Agent": fetch_yahoo_profile.USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
    })

    results = dict(existing)  # 從既存複製，後續覆蓋
    succ = 0
    fail = []
    start = time.time()

    for i, sid in enumerate(to_fetch, 1):
        data = fetch_yahoo_profile.fetch_profile(sid, session=session)
        if not data:
            # 重試一次
            time.sleep(delay)
            data = fetch_yahoo_profile.fetch_profile(sid, session=session)

        if data:
            data["_fetched_at"] = today_str
            results[sid] = data
            succ += 1
            biz = data.get("business", "")
            preview = biz[:30] + ("..." if len(biz) > 30 else "")
            logger.info("[%d/%d] ✓ %s %s | %s",
                        i, len(to_fetch), sid, data.get("name", "?"), preview)
        else:
            fail.append(sid)
            logger.warning("[%d/%d] ✗ %s 抓取失敗", i, len(to_fetch), sid)

        # 每 50 支中途存檔
        if i % 50 == 0:
            with open(PROFILES_PATH, "w", encoding="utf-8") as f:
                json.dump(results, f, ensure_ascii=False, indent=2)
            elapsed = time.time() - start
            avg = elapsed / i
            logger.info("--- 進度 %d/%d，平均 %.2fs/支，預估剩餘 %.1f 分鐘 ---",
                        i, len(to_fetch), avg, (len(to_fetch) - i) * avg / 60)

        if i < len(to_fetch):
            time.sleep(delay)

    # 最終存檔
    with open(PROFILES_PATH, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    elapsed = time.time() - start
    logger.info("")
    logger.info("=== 完成 ===")
    logger.info("成功：%d / %d 支", succ, len(to_fetch))
    logger.info("總時間：%.1f 秒 (%.1f 分鐘)", elapsed, elapsed / 60)
    if fail:
        logger.warning("失敗 %d 支：%s%s",
                       len(fail), fail[:10], "..." if len(fail) > 10 else "")
    logger.info("輸出：%s (%d 支)", PROFILES_PATH, len(results))


if __name__ == "__main__":
    force = "--force" in sys.argv
    max_age = 30
    if "--max-age" in sys.argv:
        idx = sys.argv.index("--max-age")
        if idx + 1 < len(sys.argv):
            max_age = int(sys.argv[idx + 1])
    run(force=force, max_age_days=max_age)
