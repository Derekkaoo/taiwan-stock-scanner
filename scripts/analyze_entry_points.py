"""
analyze_entry_points.py — 分析每支股票的進場點統計（多頭排列回測研究）

對每支股票的歷史 K 線：
1. 找所有「多頭觸發事件」(MA5>MA10>MA20 多頭排列 + 收盤創 60 日新高)
2. 觸發後追蹤回測 MA5/MA10/MA20 行為（最低價碰觸即成立）
3. 「成功回測」= 後續 10 個交易日內收盤創波段新高
4. 多頭結束（MA5 < MA10）→ 該次事件結束
5. 統計各級 MA 命中率 + 成功率 + 平均報酬

輸出：backend/db/entry_analysis.json
{
  "updated": "...",
  "by_stock": {
    "2330": {
      "sample_size": 3,            # 過去多頭事件次數
      "stats": {
        "5":  {"hit_rate": 0.67, "success_rate": 0.50, "avg_return": 12.3},
        "10": {"hit_rate": 0.33, "success_rate": 1.00, "avg_return": 18.7},
        "20": {"hit_rate": 0.00, ...},
        "no_pullback": {"count": 1, "avg_return": 25.0}   # 從不回測直接漲
      },
      "events": [
        {
          "trigger_date": "2025/06/15",
          "trigger_close": 850.0,
          "end_date": "2025/09/03",
          "end_close": 1020.0,
          "highest_close": 1050.0,
          "max_drawdown_pct": -5.2,
          "return_pct": 20.0,
          "deepest_pullback_ma": 5,
          "ongoing": false,
          "pullbacks": [
            {"date":"2025/07/10","ma_level":5,"success":true,"days_from_trigger":15,
             "return_to_end_pct":18.5}
          ]
        }
      ]
    }
  }
}

用法：
  python scripts/analyze_entry_points.py            # 跑全部股票
  python scripts/analyze_entry_points.py 2330       # 單支 debug
"""
from __future__ import annotations
import json
import logging
import sys
import time
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent.parent / "frontend" / "public" / "data"
DB_DIR   = Path(__file__).parent.parent / "backend" / "db"
OUT_PATH = DATA_DIR / "entry_analysis.json"   # 直接寫到 frontend 給前端 fetch

PULLBACK_WINDOW = 20   # 回測後幾天內要創新高才算成功
LOOKBACK_FOR_HIGH = 200 # 200 日新高

# === 訊號品質過濾（過濾雜訊，留下真正大波段觸發）===
FILTER_VOLUME = False      # A. 量能確認：關閉，不過濾觸發；讓 user 從 3 種退場對比看細節
VOLUME_RATIO = 1.5
FILTER_MARKET_BULL = False # B. 大盤環境：觸發日 TWII MA20 > MA60（先關掉）
FILTER_NO_PARABOLIC = False # D. 短期不過熱：突破前 N 天漲幅不超過 X%（關掉，不預設「漲多了不能追」）
PARABOLIC_WINDOW = 10      # 看過去 N 天
PARABOLIC_THRESHOLD = 0.20 # 漲幅 > 20% 視為追高
FILTER_BREAKOUT_STRENGTH = True  # C. 突破力道：收盤至少超出前 N 日高 X%（過濾擦邊突破，N = LOOKBACK_FOR_HIGH）
BREAKOUT_MARGIN = 1.01     # 1.01 = 至少超出 1%


def compute_ma(bars: list[dict], period: int, key: str = 'c') -> list[float | None]:
    """N 日 MA。前 period-1 個元素為 None。"""
    out: list[float | None] = [None] * len(bars)
    if len(bars) < period:
        return out
    s = sum(bars[i][key] for i in range(period))
    out[period - 1] = s / period
    for i in range(period, len(bars)):
        s += bars[i][key] - bars[i - period][key]
        out[i] = s / period
    return out


def compute_period_high(bars: list[dict], period: int, key: str = 'c') -> list[float | None]:
    """往前 period 個 bar 的最高 close（含當日）。"""
    out: list[float | None] = [None] * len(bars)
    for i in range(period - 1, len(bars)):
        out[i] = max(bars[j][key] for j in range(i - period + 1, i + 1))
    return out


def compute_avg_volume(bars: list[dict], period: int = 20) -> list[float | None]:
    """N 日平均成交量。前 period-1 個元素為 None。"""
    out: list[float | None] = [None] * len(bars)
    if len(bars) < period:
        return out
    s = sum(bars[i].get('v', 0) for i in range(period))
    out[period - 1] = s / period
    for i in range(period, len(bars)):
        s += bars[i].get('v', 0) - bars[i - period].get('v', 0)
        out[i] = s / period
    return out


def normalize_date(s: str) -> str:
    """K 線是 YYYY/MM/DD，TWII 是 YYYY-MM-DD，統一成 YYYY-MM-DD。"""
    return s.replace('/', '-')


def load_twii_regimes() -> dict[str, str]:
    """讀 TWII history，per-day 算 MA20/MA60，回傳 {date: 'bull'|'bear'}。"""
    twii_path = Path(__file__).parent.parent / "backend" / "db" / "twii.json"
    if not twii_path.exists():
        logger.warning("twii.json 不存在，filter B 無法生效")
        return {}
    try:
        d = json.loads(twii_path.read_text(encoding='utf-8'))
        history = d.get('history', [])
    except Exception as e:
        logger.warning("twii.json 讀取失敗：%s", e)
        return {}
    if len(history) < 60:
        logger.warning("twii.json history 太短（%d 天）→ 跑 scrape_twii 補資料", len(history))
        return {}

    closes = [b['close'] for b in history]
    regimes: dict[str, str] = {}
    for i in range(59, len(history)):
        ma20 = sum(closes[i - 19:i + 1]) / 20
        ma60 = sum(closes[i - 59:i + 1]) / 60
        regimes[history[i]['date']] = 'bull' if ma20 > ma60 else 'bear'
    return regimes


def analyze_stock(stock_id: str, bars: list[dict],
                  twii_regimes: dict[str, str] | None = None) -> dict | None:
    """對單一股票分析。回傳「4 種進場策略」的統計結果。

    策略：
      breakout - 觸發點直接進場
      ma5      - 等首次回測 MA5 才進場
      ma10     - 等首次回測 MA10 才進場
      ma20     - 等首次回測 MA20 才進場

    每個策略指標：
      hit_rate   命中率（過去事件中該機會出現的比例）
      win_rate   勝率（觸發進場後 → 該波結束時是否獲利）
      avg_return 平均報酬 %（進場到該波結束）
      avg_mae    平均最大不利幅度 %（進場後曾經面臨的最大跌幅，越接近 0 越好）
      rr_ratio   風報比 = avg_return / |avg_mae|
    """
    if len(bars) < LOOKBACK_FOR_HIGH + 5:
        return None

    ma5  = compute_ma(bars, 5)
    ma10 = compute_ma(bars, 10)
    ma20 = compute_ma(bars, 20)
    h60  = compute_period_high(bars, LOOKBACK_FOR_HIGH)
    avg_vol = compute_avg_volume(bars, 20)

    events: list[dict] = []
    in_run = False
    run: dict | None = None

    n = len(bars)
    for i in range(LOOKBACK_FOR_HIGH, n):
        b = bars[i]
        m5, m10, m20, hh = ma5[i], ma10[i], ma20[i], h60[i]
        if m5 is None or m10 is None or m20 is None or hh is None:
            continue

        is_bullish = m5 > m10 > m20
        is_new_high = b['c'] >= hh

        if not in_run:
            # 等多頭排列 + 收盤創 60 日新高
            if is_bullish and is_new_high:
                # === 訊號品質過濾 ===
                # A. 量能：觸發日成交量 > 20 日均量 × 倍率
                if FILTER_VOLUME and avg_vol[i] is not None:
                    if b.get('v', 0) < avg_vol[i] * VOLUME_RATIO:
                        continue
                # B. 大盤環境：觸發日 TWII MA20 > MA60（多頭）
                if FILTER_MARKET_BULL and twii_regimes:
                    regime = twii_regimes.get(normalize_date(b['date']))
                    if regime != 'bull':
                        continue
                # D. 短期不過熱：過去 N 天漲幅不超過 X%（避開追高型暴衝）
                if FILTER_NO_PARABOLIC and i >= PARABOLIC_WINDOW:
                    prev_close = bars[i - PARABOLIC_WINDOW]['c']
                    if prev_close > 0:
                        short_gain = (b['c'] - prev_close) / prev_close
                        if short_gain > PARABOLIC_THRESHOLD:
                            continue
                # C. 突破力道：收盤至少超出「前 120 日（不含今日）」最高 X%
                if FILTER_BREAKOUT_STRENGTH and i > 0:
                    prev_high = h60[i - 1]  # 注意 h60 變數名其實是 LOOKBACK_FOR_HIGH 配置（=120）
                    if prev_high is not None and b['c'] < prev_high * BREAKOUT_MARGIN:
                        continue
                in_run = True
                run = {
                    'trigger_idx':       i,
                    'trigger_date':      b['date'],
                    'trigger_close':     b['c'],
                    'highest_close':     b['c'],
                    # 4 個進場點記錄：(idx, close)
                    'first_ma5_touch':   None,
                    'first_ma10_touch':  None,
                    'first_ma20_touch':  None,
                    # 3 個退場 idx（first close < MAx）
                    'first_break_ma5_idx':  None,
                    'first_break_ma10_idx': None,
                    'first_break_ma20_idx': None,
                }
            continue

        assert run is not None
        # 偵測首次跌破各級 MA（用收盤）— 給「不同退場規則」對比用
        if run['first_break_ma5_idx']  is None and b['c'] < m5:
            run['first_break_ma5_idx']  = i
        if run['first_break_ma10_idx'] is None and b['c'] < m10:
            run['first_break_ma10_idx'] = i
        if run['first_break_ma20_idx'] is None and b['c'] < m20:
            run['first_break_ma20_idx'] = i

        # 事件結束條件：收盤跌破 MA20（最寬鬆退場 = 整波結束）
        if b['c'] < m20:
            run['end_idx']   = i
            run['end_date']  = b['date']
            run['end_close'] = b['c']
            run['ongoing']   = False
            events.append(run)
            in_run = False
            run = None
            continue

        # 更新該波最高
        if b['c'] > run['highest_close']:
            run['highest_close'] = b['c']

        # 偵測首次回測各級 MA（用最低價）
        low = b['l']
        if run['first_ma5_touch']  is None and low <= m5:
            run['first_ma5_touch']  = (i, b['c'])
        if run['first_ma10_touch'] is None and low <= m10:
            run['first_ma10_touch'] = (i, b['c'])
        if run['first_ma20_touch'] is None and low <= m20:
            run['first_ma20_touch'] = (i, b['c'])

    # 處理還在進行中的 run
    if in_run and run is not None:
        last = bars[-1]
        run['end_idx']   = n - 1
        run['end_date']  = last['date']
        run['end_close'] = last['c']
        run['ongoing']   = True
        events.append(run)

    if not events:
        return {'stock_id': stock_id, 'sample_size': 0, 'strategies': {}, 'events': []}

    # 對每個事件計算 4 種進場 × 3 種退場 = 12 個組合
    for ev in events:
        end_idx_default = ev['end_idx']  # 整波結束（close < MA20）
        # 三種退場規則的退場 idx；沒觸發過就用 end_idx_default
        exit_indices = {
            'ma5':  ev['first_break_ma5_idx']  if ev['first_break_ma5_idx']  is not None else end_idx_default,
            'ma10': ev['first_break_ma10_idx'] if ev['first_break_ma10_idx'] is not None else end_idx_default,
            'ma20': ev['first_break_ma20_idx'] if ev['first_break_ma20_idx'] is not None else end_idx_default,
        }
        ev['exits'] = {
            label: {
                'date':  bars[idx]['date'],
                'close': bars[idx]['c'],
            } for label, idx in exit_indices.items()
        }

        trigger_idx   = ev['trigger_idx']
        trigger_close = ev['trigger_close']

        # Helper：給定 entry_idx 跟 entry_close，算 3 種退場下的 return + MAE
        def _by_exit(entry_idx: int, entry_close: float) -> dict:
            out = {}
            for exit_label, exit_idx in exit_indices.items():
                # 退場早於進場 → 該組合 invalid（譬如進場 MA5 那天「之前」就跌破 MA5）
                if exit_idx < entry_idx:
                    out[exit_label] = None
                    continue
                exit_close = bars[exit_idx]['c']
                lowest = min(bars[j]['c'] for j in range(entry_idx, exit_idx + 1))
                out[exit_label] = {
                    'return_pct': round((exit_close - entry_close) / entry_close * 100, 2),
                    'mae_pct':    round((lowest - entry_close) / entry_close * 100, 2),
                }
            return out

        # 策略 A: 突破直入
        ev['breakout'] = {
            'date':         ev['trigger_date'],
            'entry_close':  trigger_close,
            'by_exit':      _by_exit(trigger_idx, trigger_close),
        }

        # 策略 B/C/D: 等回測 MA5/10/20
        for label, key in [('ma5', 'first_ma5_touch'),
                           ('ma10', 'first_ma10_touch'),
                           ('ma20', 'first_ma20_touch')]:
            touch = ev[key]
            if touch is None:
                ev[label] = None
                continue
            entry_idx, entry_close = touch
            ev[label] = {
                'date':              bars[entry_idx]['date'],
                'entry_close':       entry_close,
                'days_from_trigger': entry_idx - trigger_idx,
                'by_exit':           _by_exit(entry_idx, entry_close),
            }

        # 清掉內部欄位
        for k in ('trigger_idx', 'end_idx', 'end_date', 'end_close',
                  'first_ma5_touch', 'first_ma10_touch', 'first_ma20_touch',
                  'first_break_ma5_idx', 'first_break_ma10_idx', 'first_break_ma20_idx'):
            ev.pop(k, None)

    # 跨事件聚合 → 4 進場 × 3 退場 = 12 個策略統計
    total = len(events)
    strategies: dict[str, dict] = {}
    for entry_label in ('breakout', 'ma5', 'ma10', 'ma20'):
        strategies[entry_label] = {}
        for exit_label in ('ma5', 'ma10', 'ma20'):
            results = []
            for ev in events:
                e = ev.get(entry_label)
                if e is None:
                    continue
                r = e['by_exit'].get(exit_label)
                if r is None:
                    continue
                results.append(r)
            count = len(results)
            if count == 0:
                strategies[entry_label][exit_label] = {
                    'count': 0, 'win_count': 0, 'win_rate': None,
                    'avg_return': None, 'avg_mae': None, 'rr_ratio': None,
                }
                continue
            wins = sum(1 for r in results if r['return_pct'] > 0)
            avg_ret = sum(r['return_pct'] for r in results) / count
            avg_mae = sum(r['mae_pct']    for r in results) / count
            rr = round(avg_ret / abs(avg_mae), 2) if avg_mae < -0.001 else None
            strategies[entry_label][exit_label] = {
                'count':      count,
                'win_count':  wins,
                'win_rate':   round(wins / count, 3),
                'avg_return': round(avg_ret, 2),
                'avg_mae':    round(avg_mae, 2),
                'rr_ratio':   rr,
            }

    # 找風報比最高的 (entry, exit) 組合作為「推薦進場」
    best = None
    for entry_label, by_exit in strategies.items():
        for exit_label, st in by_exit.items():
            if st.get('count', 0) == 0 or st.get('rr_ratio') is None:
                continue
            if best is None or st['rr_ratio'] > best['rr_ratio']:
                best = {
                    'entry':       entry_label,
                    'exit':        exit_label,
                    'count':       st['count'],
                    'win_rate':    st['win_rate'],
                    'avg_return':  st['avg_return'],
                    'avg_mae':     st['avg_mae'],
                    'rr_ratio':    st['rr_ratio'],
                }

    return {
        'stock_id':    stock_id,
        'sample_size': total,
        'best':        best,
        'strategies':  strategies,
        'events':      events,
    }


def run() -> int:
    target_id = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else None

    klines_path = DATA_DIR / "klines.json"
    if not klines_path.exists():
        logger.error("klines.json 不存在")
        return 1
    klines = json.loads(klines_path.read_text(encoding="utf-8"))
    logger.info("載入 klines.json：%d 支股票", len(klines))

    twii_regimes = load_twii_regimes() if FILTER_MARKET_BULL else {}
    if FILTER_MARKET_BULL:
        logger.info("載入 TWII regimes：%d 個交易日", len(twii_regimes))
    logger.info("Filters: volume=%s (%.1fx), market_bull=%s",
                FILTER_VOLUME, VOLUME_RATIO, FILTER_MARKET_BULL)

    if target_id:
        if target_id not in klines:
            logger.error("找不到股票 %s（available: %s...）", target_id, list(klines.keys())[:5])
            return 1
        result = analyze_stock(target_id, klines[target_id], twii_regimes)
        if not result:
            logger.warning("[%s] 資料不足", target_id)
            return 0
        logger.info("=== %s 分析結果（樣本數 %d）===", target_id, result['sample_size'])
        if result['sample_size'] == 0:
            logger.info("過去無多頭觸發事件")
            return 0

        # 3 個退場規則各印一張對比表
        labels = {'breakout': '突破直入', 'ma5': '回測MA5', 'ma10': '回測MA10', 'ma20': '回測MA20'}
        exit_names = {'ma5': '收盤跌破 MA5', 'ma10': '收盤跌破 MA10', 'ma20': '收盤跌破 MA20'}
        for exit_label, exit_name in exit_names.items():
            logger.info("")
            logger.info("=== 退場規則：%s ===", exit_name)
            logger.info("策略         筆數  勝率   平均報酬  平均MAE  風報比")
            logger.info("─────────────────────────────────────────────────────")
            for k, name in labels.items():
                s = result['strategies'][k][exit_label]
                if s['count'] == 0:
                    logger.info("%s     0    -      -         -        -      (從未觸發)", name)
                    continue
                logger.info("%s     %3d   %5.1f%%  %+6.2f%%  %+6.2f%%   %s",
                            name,
                            s['count'], s['win_rate'] * 100,
                            s['avg_return'], s['avg_mae'],
                            f"{s['rr_ratio']:.2f}" if s['rr_ratio'] is not None else "  -  ")
        logger.info("")
        logger.info("各事件明細（每筆顯示 3 種退場下的報酬）：")
        for ev in result['events']:
            tag = '進行中' if ev.get('ongoing') else '已結束'
            exits = ev.get('exits', {})
            logger.info("  ─── %s 觸發 [%s] ───", ev['trigger_date'], tag)
            logger.info("       退場 close<MA5 = %s @%.2f / close<MA10 = %s @%.2f / close<MA20 = %s @%.2f",
                        exits['ma5']['date'],  exits['ma5']['close'],
                        exits['ma10']['date'], exits['ma10']['close'],
                        exits['ma20']['date'], exits['ma20']['close'])
            for k, name in labels.items():
                e = ev.get(k)
                if e is None:
                    logger.info("    %s: 從未觸發", name)
                    continue
                # 印 3 種退場下的 return / MAE
                parts = []
                for x in ('ma5', 'ma10', 'ma20'):
                    r = e['by_exit'].get(x)
                    if r is None:
                        parts.append(f"{x}=- ")
                    else:
                        parts.append(f"<{x.upper()}: 報酬 {r['return_pct']:+.1f}% MAE {r['mae_pct']:+.1f}%")
                logger.info("    %s @%.2f → %s",
                            name, e['entry_close'], "  |  ".join(parts))
        return 0

    # 全部股票
    by_stock: dict[str, dict] = {}
    skipped = 0
    no_event = 0

    for sid, bars in klines.items():
        result = analyze_stock(sid, bars, twii_regimes)
        if result is None:
            skipped += 1
            continue
        by_stock[sid] = result
        if result['sample_size'] == 0:
            no_event += 1

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    out = {
        'updated':  time.strftime("%Y-%m-%dT%H:%M:%S"),
        'by_stock': by_stock,
    }
    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    logger.info("寫入 %s", OUT_PATH)
    logger.info("總結：分析 %d 支 / 資料不足 %d 支 / 0 事件 %d 支",
                len(by_stock), skipped, no_event)

    # 統計分佈
    sample_dist = {}
    for r in by_stock.values():
        n = r['sample_size']
        sample_dist[n] = sample_dist.get(n, 0) + 1
    logger.info("樣本數分佈：")
    for n in sorted(sample_dist.keys()):
        logger.info("  N=%d: %d 支", n, sample_dist[n])
    return 0


if __name__ == "__main__":
    sys.exit(run())
