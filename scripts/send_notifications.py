"""
Pipeline 跑完後，比較本週 vs 上週的 stocks.json，把「我的最愛」變動推到 Telegram。

讀 .env：
  USER_FAVORITES_TOKEN  - 你的 user UUID（前端 localStorage 那組）
  FAVORITES_API_URL     - Cloudflare Pages /api/favorites 完整 URL
                          預設 https://feature-favorites-v2.taiwan-stock-scanner.pages.dev/api/favorites
                          merge 到 master 後改 https://taiwan-stock-scanner.pages.dev/api/favorites
  TELEGRAM_BOT_TOKEN    - bot token（send_telegram.py 用）
  TELEGRAM_CHAT_ID      - 你的 chat id（send_telegram.py 用）

流程：
  1. 從 Cloudflare API 拿你的最愛清單
  2. 讀 frontend/public/data/stocks.json（本週）
  3. 讀 backend/db/prev_stocks.json（上週快照）
  4. Diff：分類成「新進榜 / 增持 / 減持 / 持平 / 跌出榜」
  5. 組訊息丟 Telegram
  6. 把本週存成 prev_stocks.json（給下次 diff 用）

第一次跑時：沒 prev_stocks.json → 只存快照、不發訊息

用法：
  python scripts/send_notifications.py            # 正式跑
  python scripts/send_notifications.py --dry-run  # 印訊息但不發 Telegram
"""
import json
import logging
import os
import shutil
import sys
from datetime import datetime, timedelta
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent))
import send_telegram

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent.parent / "frontend" / "public" / "data"
DB_DIR = Path(__file__).parent.parent / "backend" / "db"
STOCKS_PATH = DATA_DIR / "stocks.json"
PREV_PATH = DB_DIR / "prev_stocks.json"

DEFAULT_API_URL = "https://feature-favorites-v2.taiwan-stock-scanner.pages.dev/api/favorites"

# delta% 變動小於這個值算「持平」
FLAT_THRESHOLD = 0.05


def _load_env():
    """讀 .env / 環境變數"""
    env = {}
    for key in ("USER_FAVORITES_TOKEN", "FAVORITES_API_URL"):
        v = os.environ.get(key, "").strip()
        if v:
            env[key] = v

    env_path = Path(__file__).parent.parent / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            if k in ("USER_FAVORITES_TOKEN", "FAVORITES_API_URL") and k not in env:
                env[k] = v

    env.setdefault("FAVORITES_API_URL", DEFAULT_API_URL)
    return env


def fetch_favorites(token, api_url):
    """從 Cloudflare API 拿最愛清單（list of stock_id）"""
    try:
        r = requests.get(api_url, headers={"Authorization": f"Bearer {token}"}, timeout=15)
        if not r.ok:
            logger.error("拿最愛清單失敗 (%d): %s", r.status_code, r.text[:200])
            return None
        data = r.json()
        return data.get("favorites", [])
    except Exception as e:
        logger.error("拿最愛清單例外：%s", e)
        return None


def load_stocks(path):
    if not path.exists():
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def diff_favorites(favorite_ids, curr_stocks, prev_stocks):
    """分類最愛股票的變化（只有 3 類，因為「在榜」= 「本週 delta > 0.1%」）

    Returns dict:
      'new'        - 本週首度入榜（上週沒在）
      'continued'  - 連續兩週在榜（連續加碼）
      'dropped'    - 上週在、本週跌出（沒繼續加碼）
    """
    curr_map = {s["id"]: s for s in (curr_stocks or [])}
    prev_map = {s["id"]: s for s in (prev_stocks or [])}

    result = {"new": [], "continued": [], "dropped": []}

    for fid in favorite_ids:
        in_curr = fid in curr_map
        in_prev = fid in prev_map

        if in_curr and not in_prev:
            result["new"].append({
                "id": fid,
                "stock": curr_map[fid],
            })
        elif in_curr and in_prev:
            # 連續兩週在榜：附上「本週 vs 上週加碼速度」資訊
            curr = curr_map[fid]
            prev = prev_map[fid]
            curr_d = float(curr.get("delta", 0) or 0)
            prev_d = float(prev.get("delta", 0) or 0)
            result["continued"].append({
                "id": fid, "stock": curr, "prev": prev,
                "curr_delta": curr_d, "prev_delta": prev_d,
                "pace_change": curr_d - prev_d,  # 加碼速度變化（>0 加碼變兇）
            })
        elif in_prev and not in_curr:
            result["dropped"].append({
                "id": fid,
                "prev": prev_map[fid],
            })
        # in_curr=False & in_prev=False → 兩週都沒在，跳過（沒必要通知）

    # 排序：依本週 delta 由大到小
    result["new"].sort(key=lambda x: -float(x["stock"].get("delta", 0) or 0))
    result["continued"].sort(key=lambda x: -x["curr_delta"])
    return result


def fmt_amount(yi):
    """億元格式化"""
    if not yi:
        return ""
    abs_v = abs(yi)
    sign = "+" if yi >= 0 else "-"
    if abs_v >= 100:
        return f"{sign}{abs_v:.0f} 億"
    if abs_v >= 1:
        return f"{sign}{abs_v:.1f} 億"
    wan = abs_v * 10000
    return f"{sign}{wan:.0f} 萬"


def build_message(diff, today_str):
    """組 Telegram 訊息（HTML 格式）

    扁平化：不分類，本週在榜的最愛全部列出（按本週 delta% 由大到小）
    跌出榜的不通知（沒在 stocks.json 裡的 = 本週 < 0.1%、不重要）
    """
    # 合併「新進」+「持續加碼」（兩種都是本週在榜的最愛）
    in_list = []
    for item in diff["new"]:
        s = item["stock"]
        in_list.append({
            "stock": s,
            "delta": float(s.get("delta", 0) or 0),
            "is_new": True,
        })
    for item in diff["continued"]:
        s = item["stock"]
        in_list.append({
            "stock": s,
            "delta": item["curr_delta"],
            "is_new": False,
        })

    if not in_list:
        return None

    # 按本週 delta% 由大到小
    in_list.sort(key=lambda x: -x["delta"])

    lines = [f"📊 <b>大戶持股週更</b>  {today_str}", ""]
    lines.append(f"⭐ 你的最愛本週在榜 <b>{len(in_list)}</b> 支：")
    lines.append("")

    for item in in_list:
        s = item["stock"]
        d = item["delta"]
        holding = float(s.get("holdingPct", 0) or 0)
        mc_change = (d * float(s.get("marketCap", 0) or 0)) / 100
        new_tag = " 🆕" if item["is_new"] else ""

        line = f"  {s['id']} {s.get('name', '?')}{new_tag}  +{d:.2f}% / 累計 {holding:.1f}%"
        if mc_change > 0:
            line += f"  ({fmt_amount(mc_change)})"
        lines.append(line)

    lines.append("")
    lines.append('🔗 <a href="https://taiwan-stock-scanner.pages.dev">完整資料</a>')
    return "\n".join(lines)


def run(dry_run=False):
    today = (datetime.utcnow() + timedelta(hours=8)).strftime("%Y/%m/%d")
    logger.info("=== 推播 ===")

    env = _load_env()
    user_token = env.get("USER_FAVORITES_TOKEN")
    api_url = env["FAVORITES_API_URL"]

    if not user_token:
        logger.warning("沒 USER_FAVORITES_TOKEN（在 .env），略過")
        return

    # 1. 拿最愛
    favorites = fetch_favorites(user_token, api_url)
    if favorites is None:
        logger.error("拿最愛失敗，停手")
        return
    logger.info("最愛清單：%d 支", len(favorites))
    if not favorites:
        logger.info("最愛空，不發")
        return

    # 2. 讀本週 stocks.json
    curr = load_stocks(STOCKS_PATH)
    if not curr:
        logger.error("找不到 %s", STOCKS_PATH)
        return

    # 3. 讀上週快照
    prev = load_stocks(PREV_PATH)
    if prev is None:
        logger.info("沒 prev_stocks.json（首次跑），存快照、不發訊息")
        if not dry_run:
            DB_DIR.mkdir(parents=True, exist_ok=True)
            shutil.copy(STOCKS_PATH, PREV_PATH)
            logger.info("快照存好：%s", PREV_PATH)
        return

    # 4. Diff
    diff = diff_favorites(favorites, curr, prev)
    logger.info("Diff: 新進 %d, 持續加碼 %d, 跌出 %d",
                len(diff["new"]), len(diff["continued"]), len(diff["dropped"]))

    # 5. 組訊息
    msg = build_message(diff, today)
    if not msg:
        logger.info("沒內容可發")
        return

    print()
    print("=" * 50)
    print(msg)
    print("=" * 50)
    print()

    if dry_run:
        logger.info("--dry-run 模式：不實際發送")
        return

    # 6. 發 Telegram
    if send_telegram.send_message(msg):
        logger.info("✅ 已發送 Telegram")
    else:
        logger.error("❌ Telegram 發送失敗")
        return

    # 7. 更新 prev 快照
    DB_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy(STOCKS_PATH, PREV_PATH)
    logger.info("快照已更新：%s", PREV_PATH)


if __name__ == "__main__":
    dry = "--dry-run" in sys.argv
    run(dry_run=dry)
