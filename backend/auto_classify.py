"""
auto_classify.py
使用 Claude API 自動為台股股票分配實務族群 + 業務說明

執行方式：
  1. 先設環境變數：set ANTHROPIC_API_KEY=sk-ant-...
     （或加到 .env；本 script 預設讀 os.environ）
  2. venv\Scripts\python.exe auto_classify.py

費用估算：422 支股票，每批 30 支，約 15 次 API 呼叫
使用 claude-haiku-4-5（最省錢），預估花費 < $0.10 美元
"""
import json
import os
import sys
import time
import logging
import requests
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

# ── 設定 ──────────────────────────────────────────────────────
# API key 從環境變數讀，不寫死在 code 裡（公開 repo 後避免 leak）
API_KEY = os.environ.get("ANTHROPIC_API_KEY")
if not API_KEY:
    logger.error("ANTHROPIC_API_KEY 環境變數未設定。")
    logger.error("請執行：set ANTHROPIC_API_KEY=sk-ant-...  （或加到 .env）")
    sys.exit(1)
API_URL    = "https://api.anthropic.com/v1/messages"
MODEL      = "claude-haiku-4-5"   # 最省成本
BATCH_SIZE = 30                    # 每批幾支股票

STOCKS_JSON = Path(__file__).parent.parent / "frontend" / "public" / "data" / "stocks.json"
DICT_JSON   = Path(__file__).parent.parent / "frontend" / "public" / "data" / "stock_dict.json"

# ── 可用族群清單（讓 Claude 從這裡選）────────────────────────
AVAILABLE_GROUPS = [
    "AI伺服器", "IC設計/半導體", "晶圓代工", "散熱", "CPO矽光子",
    "CoWoS先進封裝", "PCB載板", "被動元件", "連接器", "電源供應器",
    "線材Cable", "電子零組件", "重電電網", "太陽能", "風電", "儲能電池",
    "機器人", "工業自動化", "機電工程", "鋼鐵", "塑化", "紡織", "水泥",
    "生技醫療", "新藥CDMO", "航運", "貨櫃航運", "金控銀行", "保險",
    "證券資管", "5G通訊", "車用電子", "光電/LED", "光學/鏡頭",
    "雲端SaaS", "資安", "食品飲料", "建設營造", "觀光餐飲", "貿易零售",
    "傳產其他", "其他/未分組"
]

SYSTEM_PROMPT = f"""你是台股產業分析師，專精於將股票分配到市場實務族群。

可用族群清單：
{chr(10).join(f"- {g}" for g in AVAILABLE_GROUPS)}

規則：
1. 只能從上方族群清單中選擇，不可自創族群名稱
2. 依照公司實際主要業務分類，不是官方產業別
3. 業務說明限 20 字以內，說明公司主要做什麼
4. 回傳純 JSON，不要有任何其他文字

回傳格式範例：
[
  {{"id": "2330", "group": "晶圓代工", "desc": "全球最大晶圓代工廠"}},
  {{"id": "3008", "group": "光學/鏡頭", "desc": "全球最大手機鏡頭廠"}}
]"""


def call_claude(stocks_batch: list[dict]) -> list[dict]:
    """呼叫 Claude API 為一批股票分類"""
    stock_list = "\n".join(
        f"{s['id']} {s['name']}（官方產業：{s.get('industry', '未知')}）"
        for s in stocks_batch
    )
    user_msg = f"請為以下台股股票分配族群和業務說明：\n\n{stock_list}"

    resp = requests.post(
        API_URL,
        headers={
            "x-api-key":         API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type":      "application/json",
        },
        json={
            "model":      MODEL,
            "max_tokens": 2000,
            "system":     SYSTEM_PROMPT,
            "messages":   [{"role": "user", "content": user_msg}],
        },
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()
    text = data["content"][0]["text"].strip()

    # 解析 JSON（容錯：移除可能的 markdown 標記）
    text = text.replace("```json", "").replace("```", "").strip()
    return json.loads(text)


def run():
    # 讀取 stocks.json
    if not STOCKS_JSON.exists():
        logger.error("找不到 stocks.json，請先執行 run_pipeline.py")
        return

    with open(STOCKS_JSON, encoding="utf-8") as f:
        stocks = json.load(f)

    logger.info("共 %d 支股票需要分類", len(stocks))

    # 讀取現有字典（若有）
    stock_dict = {}
    if DICT_JSON.exists():
        with open(DICT_JSON, encoding="utf-8") as f:
            stock_dict = json.load(f)

    # 分批處理
    results = {}
    total_batches = (len(stocks) + BATCH_SIZE - 1) // BATCH_SIZE

    for i in range(0, len(stocks), BATCH_SIZE):
        batch = stocks[i:i + BATCH_SIZE]
        batch_num = i // BATCH_SIZE + 1
        logger.info("處理第 %d/%d 批（%d 支）…", batch_num, total_batches, len(batch))

        try:
            classified = call_claude(batch)
            for item in classified:
                results[item["id"]] = {
                    "group": item.get("group", "其他/未分組"),
                    "groupDesc": item.get("desc", ""),
                }
            logger.info("  ✓ 第 %d 批完成，分類 %d 支", batch_num, len(classified))
        except Exception as e:
            logger.error("  ✗ 第 %d 批失敗：%s", batch_num, e)

        # 避免觸發速率限制
        if i + BATCH_SIZE < len(stocks):
            time.sleep(1)

    # 更新 stocks.json
    updated = 0
    for stock in stocks:
        if stock["id"] in results:
            stock["group"]     = results[stock["id"]]["group"]
            stock["groupDesc"] = results[stock["id"]]["groupDesc"]
            updated += 1

    with open(STOCKS_JSON, "w", encoding="utf-8") as f:
        json.dump(stocks, f, ensure_ascii=False, indent=2)
    logger.info("stocks.json 更新完成：%d 支", updated)

    # 更新 stock_dict.json
    for sid, info in results.items():
        if sid in stock_dict:
            stock_dict[sid]["group"]     = info["group"]
            stock_dict[sid]["groupDesc"] = info["groupDesc"]

    if stock_dict:
        with open(DICT_JSON, "w", encoding="utf-8") as f:
            json.dump(stock_dict, f, ensure_ascii=False, indent=2)
        logger.info("stock_dict.json 更新完成")

    # 統計族群分布
    from collections import Counter
    groups = Counter(s["group"] for s in stocks)
    logger.info("族群分布（前 20）：")
    for g, cnt in groups.most_common(20):
        logger.info("  %-22s %d 支", g, cnt)

    logger.info("完成！請重新整理瀏覽器查看結果")


if __name__ == "__main__":
    run()