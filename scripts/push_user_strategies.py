"""
push_user_strategies.py — 個人化每日選股 Telegram 推播（M4，本地版）

對每個 Telegram 已綁定的使用者：
  1. 撈他存在 D1 的所有策略（filters_json）
  2. 對每組 filter 跑 user_filters.apply_filters
  3. 組訊息（HTML format） → 推到該使用者的 chat_id

資料來源：
  - 綁定 + 策略：透過 `wrangler d1 execute --remote` 撈 prod D1
  - 股票主檔：frontend/public/data/stocks.json（最新 pipeline 跑出來的）

用法：
  # 1. 看格式不發送
  python scripts/push_user_strategies.py --dry-run

  # 2. 只推給某一位 user（用 email 比對）
  python scripts/push_user_strategies.py --user stiau334@gmail.com

  # 3. 真的推給所有綁定使用者
  python scripts/push_user_strategies.py

旗標：
  --dry-run             印訊息，不送 Telegram
  --user EMAIL          只處理 email 匹配的 user
  --top N               每個策略最多列 N 支（預設 15）
  --skip-empty          策略 0 命中時不顯示（預設仍顯示 ℹ️ 今日無符合）

需要 .env 設定：
  TELEGRAM_BOT_TOKEN
  （chat_id 從 D1 telegram_bindings 撈，不是 env）
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests

# Windows console UTF-8 修復
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from screeners.user_filters import apply_filters  # noqa: E402

logger = logging.getLogger(__name__)

STOCKS_JSON = ROOT / "frontend" / "public" / "data" / "stocks.json"
WEBSITE_URL = "https://taiwan-stock-scanner.pages.dev"

WEEKDAY_TW = ["週一", "週二", "週三", "週四", "週五", "週六", "週日"]


# ============================================================
#  .env loader（避免依賴 python-dotenv）
# ============================================================
def load_env() -> Dict[str, str]:
    env: Dict[str, str] = {}
    env_path = ROOT / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            env[k.strip()] = v.strip().strip('"').strip("'")
    # os.environ 優先（CI/cron 用）
    for k, v in os.environ.items():
        if k.startswith("TELEGRAM_") and v:
            env[k] = v
    return env


# ============================================================
#  從 D1 撈 bindings + strategies
# ============================================================
def fetch_d1_data() -> List[Dict[str, Any]]:
    """JOIN telegram_bindings + strategies，回每個 user 的綁定 + 策略 list

    回傳結構（已聚合）：
        [
          {
            "user_uid": "...",
            "user_email": "...",
            "chat_id": "...",
            "strategies": [
              {"id": int, "name": str, "filters": dict},
              ...
            ]
          },
          ...
        ]
    """
    sql = """
        SELECT b.user_uid, b.user_email, b.chat_id,
               s.id AS strategy_id, s.name AS strategy_name, s.filters_json
        FROM telegram_bindings b
        LEFT JOIN strategies s ON s.user_uid = b.user_uid
        ORDER BY b.user_uid, s.id
    """.strip().replace("\n", " ")

    cmd = [
        "npx", "wrangler", "d1", "execute",
        "stock-scanner-favorites",
        "--remote",
        "--json",
        "--command", sql,
    ]
    logger.info("撈 D1：%s", " ".join(cmd[:6]) + " ...")
    # Windows 上要 shell=True 才會找到 npx.cmd
    use_shell = os.name == "nt"
    result = subprocess.run(
        cmd,
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        shell=use_shell,
    )
    if result.returncode != 0:
        logger.error("wrangler d1 execute 失敗 (code=%d):\n%s", result.returncode, result.stderr)
        sys.exit(2)

    # wrangler 把 logs 跟 JSON 混在 stdout，要找出 JSON 部分（從第一個 `[` 開始）
    out = result.stdout
    json_start = out.find("[")
    if json_start < 0:
        logger.error("wrangler 沒回 JSON：%s", out[:500])
        sys.exit(2)

    try:
        payload = json.loads(out[json_start:])
    except json.JSONDecodeError as e:
        logger.error("wrangler JSON 解析失敗：%s\n%s", e, out[:500])
        sys.exit(2)

    # payload 形如 [{ "results": [...rows...], "success": true, ... }]
    if not isinstance(payload, list) or not payload:
        logger.error("wrangler 回應結構不對：%s", payload)
        sys.exit(2)

    rows = payload[0].get("results") or []

    # 聚合 by user_uid
    by_user: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        uid = r["user_uid"]
        if uid not in by_user:
            by_user[uid] = {
                "user_uid": uid,
                "user_email": r.get("user_email"),
                "chat_id": str(r.get("chat_id") or ""),
                "strategies": [],
            }
        # LEFT JOIN，可能有 binding 但沒策略 → strategy_id 為 NULL
        if r.get("strategy_id") is not None:
            try:
                filters = json.loads(r.get("filters_json") or "{}")
            except json.JSONDecodeError:
                filters = {}
            by_user[uid]["strategies"].append({
                "id": r["strategy_id"],
                "name": r.get("strategy_name") or f"策略#{r['strategy_id']}",
                "filters": filters,
            })

    return list(by_user.values())


# ============================================================
#  訊息組裝
# ============================================================
def html_escape(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def fmt_pct(v: Optional[float]) -> str:
    if v is None:
        return ""
    sign = "+" if v >= 0 else ""
    return f"{sign}{v:.2f}%"


def fmt_price(v: Optional[float]) -> str:
    if v is None:
        return "—"
    if v >= 100:
        return f"{v:.0f}"
    return f"{v:.2f}"


def format_stock_line(s: Dict[str, Any]) -> str:
    sid = html_escape(str(s.get("id", "")))
    name = html_escape(str(s.get("name", "")))
    price = fmt_price(s.get("price"))
    change = fmt_pct(s.get("dailyChangePct"))
    if change:
        return f"  • <code>{sid}</code> {name}  {change}  收 {price}"
    return f"  • <code>{sid}</code> {name}  收 {price}"


def build_user_message(
    strategies: List[Dict[str, Any]],
    matches_per_strategy: List[List[Dict[str, Any]]],
    top_n: int = 15,
    skip_empty: bool = False,
) -> str:
    now = datetime.now()
    weekday = WEEKDAY_TW[now.weekday()]
    date_str = now.strftime("%Y/%m/%d")

    lines = [f"📊 <b>你的每日選股</b> ({date_str} {weekday})", ""]

    section_count = 0
    for i, (strategy, matches) in enumerate(zip(strategies, matches_per_strategy)):
        if skip_empty and not matches:
            continue
        if section_count > 0:
            lines.append("─────────────")
            lines.append("")
        section_count += 1

        lines.append(f"🎯 <b>{html_escape(strategy['name'])}</b>")
        if not matches:
            lines.append("ℹ️ 今日無符合")
        else:
            lines.append(f"✅ {len(matches)} 支符合")
            shown = matches[:top_n]
            for s in shown:
                lines.append(format_stock_line(s))
            if len(matches) > top_n:
                lines.append(f"  <i>... 還有 {len(matches) - top_n} 支未顯示</i>")
        lines.append("")

    lines.append("─────────────")
    lines.append(f"⏱ 自動推播 ・ 共 {len(strategies)} 套策略")
    lines.append(f'🔗 <a href="{WEBSITE_URL}">查看完整篩選結果</a>')
    return "\n".join(lines)


# ============================================================
#  Telegram 發送（不走 send_telegram.py，因為 chat_id 要從 binding 取）
# ============================================================
def telegram_send(token: str, chat_id: str, text: str) -> Tuple[bool, str]:
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }
    try:
        r = requests.post(url, json=payload, timeout=10)
    except Exception as e:
        return False, f"exception: {e}"
    if not r.ok:
        return False, f"HTTP {r.status_code}: {r.text[:200]}"
    data = r.json()
    if not data.get("ok"):
        return False, f"response not ok: {data}"
    return True, "ok"


# ============================================================
#  主流程
# ============================================================
def run() -> int:
    parser = argparse.ArgumentParser(description="個人化每日選股 Telegram 推播")
    parser.add_argument("--dry-run", action="store_true", help="只印訊息，不發 Telegram")
    parser.add_argument("--user", type=str, help="只處理 email 匹配的 user")
    parser.add_argument("--top", type=int, default=15, help="每個策略最多列 N 支（預設 15）")
    parser.add_argument("--skip-empty", action="store_true", help="0 命中策略不顯示（預設顯示）")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

    env = load_env()
    bot_token = env.get("TELEGRAM_BOT_TOKEN", "").strip()
    if not bot_token and not args.dry_run:
        logger.error("缺 TELEGRAM_BOT_TOKEN（在 .env）")
        return 1

    if not STOCKS_JSON.exists():
        logger.error("找不到 stocks.json：%s", STOCKS_JSON)
        return 1

    stocks = json.loads(STOCKS_JSON.read_text(encoding="utf-8"))
    logger.info("載入 %d 支股票", len(stocks))

    users = fetch_d1_data()
    logger.info("D1 撈到 %d 位綁定使用者", len(users))

    if args.user:
        users = [u for u in users if (u.get("user_email") or "").lower() == args.user.lower()]
        logger.info("--user %s → 過濾後 %d 位", args.user, len(users))

    if not users:
        logger.warning("沒有要處理的使用者，結束")
        return 0

    sent = 0
    failed = 0
    skipped = 0

    for u in users:
        email = u.get("user_email") or "(no email)"
        chat_id = u["chat_id"]
        strategies = u["strategies"]

        if not strategies:
            logger.info("user=%s chat=%s 沒有任何策略，跳過", email, chat_id)
            skipped += 1
            continue

        logger.info("user=%s chat=%s 開始跑 %d 套策略", email, chat_id, len(strategies))

        matches_list: List[List[Dict[str, Any]]] = []
        for s in strategies:
            try:
                matches = apply_filters(stocks, s["filters"])
            except Exception as e:
                logger.error("策略 %s (id=%s) apply_filters 失敗：%s", s["name"], s["id"], e)
                matches = []
            logger.info("  ▸ %s → %d 支命中", s["name"], len(matches))
            matches_list.append(matches)

        msg = build_user_message(
            strategies, matches_list,
            top_n=args.top,
            skip_empty=args.skip_empty,
        )

        print("\n" + "=" * 60)
        print(f"To: {email} (chat {chat_id})")
        print("=" * 60)
        print(msg)
        print("=" * 60 + "\n")

        if args.dry_run:
            logger.info("--dry-run 指定，不發送")
            continue

        ok, info = telegram_send(bot_token, chat_id, msg)
        if ok:
            sent += 1
            logger.info("→ 推送成功給 %s", email)
        else:
            failed += 1
            logger.error("→ 推送失敗給 %s：%s", email, info)

    logger.info("=== 完成 sent=%d failed=%d skipped=%d ===", sent, failed, skipped)
    return 0 if failed == 0 else 3


if __name__ == "__main__":
    sys.exit(run())
